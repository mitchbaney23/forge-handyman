import { randomUUID } from "node:crypto";
import {
  appendAuditRow,
  appendContactRow,
  findCustomerByEmail,
  findRowByJobId,
  getCustomerById,
  insertCustomer,
  insertJobForCustomer,
  updateCustomerContact as writeCustomerContact,
  updateCustomerNotes,
  updateRowByJobId,
  type ContactRow,
} from "@/lib/data";
import { ACTIONS } from "@/lib/data/activity-actions";
import { checkScheduleWindow, scheduleJob } from "@/lib/crm/schedule";
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

// Contact-field validation with the SHARED schemas the public contact form
// uses (lib/security/zod.ts), so a contact added or edited by hand obeys the
// same rules as an inbound lead. Phone/email are optional (a CRM contact may
// have only a name + one channel) but validated when present; '' clears them.
// nameSchema checks min(1) on the RAW string, then trims — so a whitespace-
// only name passes and trims to ''. Reject the trimmed-empty result too.
type FieldResult = { ok: true; value: string } | { ok: false; error: string };

function validName(raw: string | undefined): FieldResult {
  const parsed = nameSchema.safeParse(raw ?? "");
  if (!parsed.success || parsed.data === "") return { ok: false, error: "A name is required." };
  return { ok: true, value: parsed.data };
}

function validPhone(raw: string | undefined): FieldResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: true, value: "" };
  const parsed = phoneSchema.safeParse(trimmed);
  if (!parsed.success) return { ok: false, error: "That phone number doesn’t look valid." };
  return { ok: true, value: parsed.data };
}

function validEmail(raw: string | undefined): FieldResult {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return { ok: true, value: "" };
  const parsed = emailSchema.safeParse(trimmed);
  if (!parsed.success) return { ok: false, error: "That email doesn’t look valid." };
  return { ok: true, value: parsed.data };
}

function normalPhone(phone: string): string {
  const r = validPhone(phone);
  return r.ok ? r.value : phone;
}

export async function createCustomer(args: {
  profile: CustomerProfileInput;
  initialDeal?: InitialDealInput;
  actor: string;
}): Promise<CreateCustomerResult> {
  // 1. Validate the profile (see validName/validPhone/validEmail above).
  const nameResult = validName(args.profile.name);
  if (!nameResult.ok) return nameResult;
  const phoneResult = validPhone(args.profile.phone);
  if (!phoneResult.ok) return phoneResult;
  const emailResult = validEmail(args.profile.email);
  if (!emailResult.ok) return emailResult;
  const name = nameResult.value;
  const phone = phoneResult.value;
  const email = emailResult.value;

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

// ---------------------------------------------------------------------------
// Edit a customer's contact details
// ---------------------------------------------------------------------------

export type ContactField = "name" | "phone" | "email";

export type UpdateCustomerContactResult =
  | { ok: true; changed: ContactField[]; jobsUpdated: number; message: string }
  | { ok: false; error: string; duplicate?: { existingId: string } };

const FIELD_WORDS: Record<ContactField, string> = { name: "name", phone: "phone", email: "email" };

// Change any of name / phone / email. A field left undefined keeps its value;
// '' clears phone or email (name is required). The change is copied onto every
// job the customer owns, because quotes, balance links and reminders are sent
// from the job's copy (see pg/customers.updateCustomerContact). The activity
// row records WHICH fields changed, never the values: the log is append-only
// and a data-deletion request does not scrub it, so it must not hold PII.
export async function updateCustomerContact(args: {
  customerId: string;
  changes: { name?: string; phone?: string; email?: string };
  actor: string;
}): Promise<UpdateCustomerContactResult> {
  const { customerId, changes, actor } = args;
  const next: { name?: string; phone?: string; email?: string } = {};
  if (changes.name !== undefined) {
    const r = validName(changes.name);
    if (!r.ok) return r;
    next.name = r.value;
  }
  if (changes.phone !== undefined) {
    const r = validPhone(changes.phone);
    if (!r.ok) return r;
    next.phone = r.value;
  }
  if (changes.email !== undefined) {
    const r = validEmail(changes.email);
    if (!r.ok) return r;
    next.email = r.value;
  }

  const customer = await getCustomerById(customerId);
  if (!customer) return { ok: false, error: "Customer not found" };
  if (customer.anonymized) {
    return { ok: false, error: "This customer's data was deleted on request, so their details can't be edited." };
  }

  // Only what actually differs gets written (and logged). customer.email is
  // already '' for a placeholder, emails compare lowercased, and phones compare
  // in the E.164 form phoneSchema stores, so re-saving "(919) 555-0142" over
  // "+19195550142" is not a change.
  const patch: { name?: string; phone?: string; email?: string } = {};
  const changed: ContactField[] = [];
  if (next.name !== undefined && next.name !== customer.name) {
    patch.name = next.name;
    changed.push("name");
  }
  if (next.phone !== undefined && next.phone !== normalPhone(customer.phone)) {
    patch.phone = next.phone;
    changed.push("phone");
  }
  if (next.email !== undefined && next.email !== customer.email.toLowerCase()) {
    patch.email = next.email;
    changed.push("email");
  }
  if (changed.length === 0) {
    return { ok: true, changed, jobsUpdated: 0, message: "Nothing changed." };
  }

  if (patch.email) {
    const owner = await findCustomerByEmail(patch.email);
    if (owner && owner.id !== customerId) {
      return {
        ok: false,
        error: "Another customer already has that email.",
        duplicate: { existingId: owner.id },
      };
    }
  }

  const written = await writeCustomerContact(customerId, patch);
  if (!written.ok) {
    if (written.reason === "duplicate") {
      // Race: the email was taken between the check and the write.
      const owner = patch.email ? await findCustomerByEmail(patch.email) : null;
      return {
        ok: false,
        error: "Another customer already has that email.",
        duplicate: owner ? { existingId: owner.id } : undefined,
      };
    }
    return { ok: false, error: "Customer not found" };
  }

  const what = changed.map((f) => FIELD_WORDS[f]).join(" and ");
  const jobs =
    written.jobsUpdated === 0
      ? ""
      : ` Also updated on their ${written.jobsUpdated} job${written.jobsUpdated === 1 ? "" : "s"}.`;
  await appendAuditRow({
    actor,
    action: ACTIONS.CUSTOMER_UPDATED,
    target: customerId,
    notes: `Changed ${what}.${jobs}`,
  });
  logger.info({ actor, customerId, fields: changed, jobsUpdated: written.jobsUpdated }, "crm: customer contact updated");
  return {
    ok: true,
    changed,
    jobsUpdated: written.jobsUpdated,
    message: `Saved the new ${what}.${jobs}`,
  };
}

// ---------------------------------------------------------------------------
// A new job for a customer already on file (+ optional schedule)
// ---------------------------------------------------------------------------

export interface NewJobInput extends InitialDealInput {
  referralSource?: string;
}

export type CreateJobResult =
  | {
      ok: true;
      jobId: string;
      scheduled: { startsAt: string; endsAt: string; calendar: string } | null;
      // Set when the job was created but the schedule step then failed: the
      // job is in the pipeline at New and can be scheduled again.
      scheduleError?: string;
      message: string;
    }
  | { ok: false; error: string };

// The job copies the customer's current name/phone/email (the job row carries
// its own copy) and lands at New, or at Booked when a schedule is given. The
// schedule window is checked BEFORE the job is written, so a taken time is a
// clean refusal rather than a stray unscheduled job.
export async function createJobForCustomer(args: {
  customerId: string;
  job: NewJobInput;
  // emailCustomer: send them the booking confirmation (default true).
  schedule?: { startsAt: string; endsAt: string; emailCustomer?: boolean };
  actor: string;
}): Promise<CreateJobResult> {
  const { customerId, job, schedule, actor } = args;
  const serviceType = (job.serviceType ?? "").trim();
  if (serviceType === "") return { ok: false, error: "Pick a service for the job." };

  const customer = await getCustomerById(customerId);
  if (!customer) return { ok: false, error: "Customer not found" };
  if (customer.anonymized) {
    return { ok: false, error: "This customer's data was deleted on request, so new jobs can't be added." };
  }

  if (schedule) {
    const check = await checkScheduleWindow(schedule);
    if (!check.ok) return check;
  }

  const priorJobs = customer.jobs.length;
  const row: ContactRow = {
    submitted_at: new Date().toISOString(),
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    address: (job.address ?? "").trim(),
    service_type: serviceType,
    preferred_date: (job.preferredDate ?? "").trim(),
    description: (job.description ?? "").trim().slice(0, 2000),
    referral_source: (job.referralSource ?? "").trim(),
    status: "New",
    job_id: randomUUID(),
    urgency: (job.urgency ?? "").trim(),
    is_returning_customer: priorJobs > 0 ? "true" : "",
    prior_job_count: String(priorJobs),
  };
  const inserted = await insertJobForCustomer(customerId, row);
  if (!inserted) return { ok: false, error: "Customer not found" };
  const jobId = inserted.jobId;

  await appendAuditRow({
    actor,
    action: ACTIONS.JOB_CREATED,
    target: jobId,
    jobId,
    notes: `Added from the customer page: ${serviceType}.`,
  });
  logger.info({ actor, customerId, jobId }, "crm: job created for customer");

  if (!schedule) {
    return { ok: true, jobId, scheduled: null, message: "Job added to the pipeline at New." };
  }
  const booked = await scheduleJob({ jobId, ...schedule, actor });
  if (!booked.ok) {
    return {
      ok: true,
      jobId,
      scheduled: null,
      scheduleError: booked.error,
      message: `Job added at New, but it was not scheduled: ${booked.error}`,
    };
  }
  return {
    ok: true,
    jobId,
    scheduled: { startsAt: booked.startsAt, endsAt: booked.endsAt, calendar: booked.calendar },
    message: `Job added and ${booked.message.charAt(0).toLowerCase()}${booked.message.slice(1)}`,
  };
}

// ---------------------------------------------------------------------------
// Adjust the balance owed
// ---------------------------------------------------------------------------

// The balance is what Mark Complete charges the saved card (or what the
// balance link asks for). It is set when the quote goes out and stays fixed
// unless someone changes it here: a job that ran short, extra work found on
// site, or a balance collected outside the app that should be zeroed so it
// is not charged twice. This never charges or refunds anything; it only
// changes the number the next charge will use, and it says why on the
// timeline.

export const MAX_BALANCE_CENTS = 5_000_000; // $50,000

export type AdjustBalanceResult =
  | { ok: true; beforeCents: number; afterCents: number; message: string }
  | { ok: false; error: string };

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function adjustBalance(args: {
  jobId: string;
  newBalanceCents: number;
  reason: string;
  actor: string;
}): Promise<AdjustBalanceResult> {
  const { jobId, newBalanceCents, actor } = args;
  if (!Number.isInteger(newBalanceCents) || newBalanceCents < 0) {
    return { ok: false, error: "Balance must be a whole number of cents, zero or more." };
  }
  if (newBalanceCents > MAX_BALANCE_CENTS) {
    return { ok: false, error: `Balance can't exceed ${dollars(MAX_BALANCE_CENTS)}.` };
  }
  const reason = (args.reason ?? "").trim().slice(0, 500);
  if (reason.length < 3) {
    return { ok: false, error: "Say why the balance changed (a few words is enough)." };
  }

  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };

  const beforeCents = Number(found.row.balance_owed_cents || "0") || 0;
  if (beforeCents === newBalanceCents) {
    return {
      ok: true,
      beforeCents,
      afterCents: newBalanceCents,
      message: `Balance already ${dollars(newBalanceCents)}; nothing changed.`,
    };
  }

  await updateRowByJobId(jobId, { balance_owed_cents: String(newBalanceCents) });
  await appendAuditRow({
    actor,
    action: ACTIONS.BALANCE_ADJUSTED,
    target: jobId,
    jobId,
    before: dollars(beforeCents),
    after: dollars(newBalanceCents),
    notes: reason,
  });
  logger.info(
    { jobId, actor, beforeCents, afterCents: newBalanceCents },
    "crm: balance adjusted",
  );
  return {
    ok: true,
    beforeCents,
    afterCents: newBalanceCents,
    message: `Balance owed changed from ${dollars(beforeCents)} to ${dollars(newBalanceCents)}.`,
  };
}

// The Stripe payment-link ids a job's timeline records for one kind of link:
// `balance_link.created` (emailed balance links) or `quote.sent` (quote
// deposit links). The id lives in the activity's JSON `after`, surfaced
// either as `data.after` or as the raw string, depending on how the row was
// read. De-duplicated, order kept.
export function linkIdsFrom(
  activities: { action: string; after?: string; data?: unknown }[],
  action: string,
): string[] {
  const ids: string[] = [];
  for (const a of activities) {
    if (a.action !== action) continue;
    let after: unknown = (a.data as { after?: unknown } | null)?.after;
    if (!after && a.after) {
      try {
        after = JSON.parse(a.after);
      } catch {
        after = null;
      }
    }
    const id = (after as { paymentLinkId?: unknown } | null)?.paymentLinkId;
    if (typeof id === "string" && id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function balanceLinkIdsFrom(
  activities: { action: string; after?: string; data?: unknown }[],
): string[] {
  return linkIdsFrom(activities, "balance_link.created");
}
