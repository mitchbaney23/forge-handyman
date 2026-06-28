import { randomUUID } from "node:crypto";
import {
  appendAuditRow,
  appendContactRow,
  findCustomerByEmail,
  findRowByJobId,
  insertCustomer,
  updateCustomerNotes,
  updateRowByJobId,
  type ContactRow,
} from "@/lib/data";
import { ACTIONS } from "@/lib/data/activity-actions";
import { canAdminTransition } from "@/lib/jobs/status-machine";
import { logger } from "@/lib/security/logger";
import { emailSchema, nameSchema, phoneSchema } from "@/lib/security/zod";

// ---------------------------------------------------------------------------
// The CRM mutation CORE — framework-free, backend-agnostic, actor-parameterized.
//
// This is the single source of truth for "move a deal" and "add a customer".
// It is called by BOTH:
//   - the admin UI (server actions in app/admin/**), actor `admin:<email>`,
//     which wrap these with requireAdmin + rate-limit + revalidatePath, and
//   - (later) an MCP server, actor `claude`, exposing the same operations to
//     Claude Cowork.
//
// Therefore this module must NOT import next/* (no revalidatePath) or touch the
// session (no requireAdmin). Each caller owns its own trust boundary and passes
// an explicit `actor`. The guardrails that MUST be uniform regardless of who
// calls — the status state machine, input validation, and activity logging —
// live here so the UI and the agent can never drift apart.
// ---------------------------------------------------------------------------

// Mirrors VALID_STATUSES from the original app/admin/jobs/[id]/actions.ts — the
// closed set the status column may hold (app-enforced; the DB column is free
// text by design, see lib/jobs/status-machine.ts).
const VALID_STATUSES = new Set([
  "New",
  "Quoted",
  "Pending Follow-Up",
  "Booked",
  "In Progress",
  "Complete",
  "Cancelled",
  "Payment Failed",
  "Refunded",
  "Partial Refund",
]);

export type MoveJobStatusResult =
  | { ok: true; before: string; after: string; message: string }
  | { ok: false; error: string };

// Move a deal between pipeline stages = change its job status. Lifted from the
// body of updateJobStatus, MINUS auth/rate-limit/revalidate (the caller's job).
// Enforces the same canAdminTransition guard, so neither the UI nor an agent can
// hand-set "Complete" (which must go through markComplete's balance charge) or
// make any other illegal jump. Webhook-driven status writes intentionally
// bypass this and call updateRowByJobId directly — Stripe owns payment states.
export async function moveJobStatus(args: {
  jobId: string;
  newStatus: string;
  actor: string;
}): Promise<MoveJobStatusResult> {
  const { jobId, newStatus, actor } = args;
  if (!VALID_STATUSES.has(newStatus)) {
    return { ok: false, error: `Invalid status: ${newStatus}` };
  }
  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };

  const before = found.row.status;
  if (before === newStatus) {
    return { ok: true, before, after: newStatus, message: "No change." };
  }
  if (!canAdminTransition(before, newStatus)) {
    return {
      ok: false,
      error:
        newStatus === "Complete"
          ? 'Use “Mark Complete” on the job to complete it — it charges the saved-card balance.'
          : `Can’t move a job from “${before}” to “${newStatus}”.`,
    };
  }

  await updateRowByJobId(jobId, { status: newStatus });
  await appendAuditRow({
    actor,
    action: ACTIONS.JOB_STATUS_CHANGED,
    target: jobId,
    jobId,
    before,
    after: newStatus,
  });
  logger.info({ jobId, actor, from: before, to: newStatus }, "crm: status changed");
  return { ok: true, before, after: newStatus, message: `Status set to ${newStatus}.` };
}

// ---------------------------------------------------------------------------
// Add a customer (+ optional first deal)
// ---------------------------------------------------------------------------

export interface CustomerProfileInput {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
}

// The optional "also start a deal" payload. service_type is the one field worth
// requiring when a deal is requested; the rest are best-effort. The new deal
// always lands in status "New" (the top of the pipeline).
export interface InitialDealInput {
  serviceType: string;
  address?: string;
  description?: string;
  preferredDate?: string; // 'YYYY-MM-DD' or ''
  urgency?: string;
}

export type CreateCustomerResult =
  | { ok: true; customerId: string; jobId?: string; message: string }
  | { ok: false; error: string; duplicate?: { existingId: string } };

export async function createCustomer(args: {
  profile: CustomerProfileInput;
  initialDeal?: InitialDealInput;
  actor: string;
}): Promise<CreateCustomerResult> {
  // 1. Validate the profile with the SHARED schemas the public contact form
  //    uses (lib/security/zod.ts), so a manually-added customer obeys the same
  //    rules as an inbound lead. Phone/email are optional here (a CRM contact
  //    may have only a name + one channel) but validated when present.
  // nameSchema checks min(1) on the RAW string, then trims — so a whitespace-
  // only name passes and trims to ''. Reject the trimmed-empty result too.
  const nameParsed = nameSchema.safeParse(args.profile.name);
  if (!nameParsed.success || nameParsed.data === "") {
    return { ok: false, error: "A name is required." };
  }
  const name = nameParsed.data;

  let phone = "";
  if ((args.profile.phone ?? "").trim() !== "") {
    const parsed = phoneSchema.safeParse(args.profile.phone);
    if (!parsed.success) return { ok: false, error: "That phone number doesn’t look valid." };
    phone = parsed.data;
  }

  let email = "";
  if ((args.profile.email ?? "").trim() !== "") {
    const parsed = emailSchema.safeParse(args.profile.email);
    if (!parsed.success) return { ok: false, error: "That email doesn’t look valid." };
    email = parsed.data;
  }

  const notes = (args.profile.notes ?? "").trim().slice(0, 2000);

  // 2. Duplicate guard — only meaningful with a real email (the unique key).
  const existing = email ? await findCustomerByEmail(email) : null;
  if (existing && !args.initialDeal) {
    // A bare re-add of an existing customer is almost certainly a mistake —
    // surface the existing record so the UI can offer "open them" instead.
    return {
      ok: false,
      error: "A customer with that email already exists.",
      duplicate: { existingId: existing.id },
    };
  }
  // With a deal, an existing email is CORRECT (returning customer, new job) —
  // appendContactRow will link the deal to that customer. Fall through.

  // 3a. With an initial deal: reuse appendContactRow, which atomically upserts
  //     the customer by email AND inserts the linked job (incl. its PK-retry).
  if (args.initialDeal) {
    const jobId = randomUUID();
    const row: ContactRow = {
      submitted_at: new Date().toISOString(),
      name,
      phone,
      email, // appendContactRow assigns an 'unknown:<uuid>' sentinel when empty
      address: (args.initialDeal.address ?? "").trim(),
      service_type: (args.initialDeal.serviceType ?? "").trim(),
      preferred_date: (args.initialDeal.preferredDate ?? "").trim(),
      description: (args.initialDeal.description ?? "").trim(),
      referral_source: "",
      status: "New",
      job_id: jobId,
      urgency: (args.initialDeal.urgency ?? "").trim(),
    };
    await appendContactRow(row);

    // Resolve the customer id (for the activity target + the return value).
    const customer = email ? await findCustomerByEmail(email) : null;
    const customerId = customer?.id ?? "";
    // Only stamp customer notes when this is a BRAND-NEW customer — never
    // clobber an existing customer's notes just because they got a new deal.
    if (notes && customerId && !existing) {
      await updateCustomerNotes(customerId, notes);
    }
    await appendAuditRow({
      actor: args.actor,
      action: ACTIONS.CUSTOMER_CREATED,
      target: customerId || jobId,
      jobId,
      after: JSON.stringify({ name, manual: true, withDeal: true, returning: Boolean(existing) }),
      notes: notes || undefined,
    });
    logger.info({ actor: args.actor, jobId, customerId }, "crm: customer + deal created");
    return {
      ok: true,
      customerId,
      jobId,
      message: existing
        ? "Added a new deal for the existing customer — it’s in the pipeline."
        : "Customer added with a new deal in the pipeline.",
    };
  }

  // 3b. Bare customer: standalone insert (the genuinely-new primitive).
  const inserted = await insertCustomer({ name, phone, email, notes });
  if ("duplicate" in inserted) {
    // Race: created between the findCustomerByEmail check and the insert.
    const racedExisting = email ? await findCustomerByEmail(email) : null;
    return {
      ok: false,
      error: "A customer with that email already exists.",
      duplicate: racedExisting ? { existingId: racedExisting.id } : undefined,
    };
  }
  await appendAuditRow({
    actor: args.actor,
    action: ACTIONS.CUSTOMER_CREATED,
    target: inserted.id,
    after: JSON.stringify({ name, manual: true, withDeal: false }),
    notes: notes || undefined,
  });
  logger.info({ actor: args.actor, customerId: inserted.id }, "crm: customer created");
  return { ok: true, customerId: inserted.id, message: "Customer added." };
}
