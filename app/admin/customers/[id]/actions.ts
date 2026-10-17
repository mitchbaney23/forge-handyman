"use server";

import { revalidatePath } from "next/cache";
import { logger } from "@/lib/security/logger";
import { checkLimit } from "@/lib/security/rate-limit";
import { rateLimitAdmin, requireAdmin } from "@/lib/admin/guard";
import { createJobForCustomer, updateCustomerContact } from "@/lib/crm/mutations";
import { easternWindow } from "@/lib/crm/schedule";
import { appendAuditRow, crmEnabled, updateCustomerNotes } from "@/lib/data";
import { ACTIONS, adminActor } from "@/lib/data/activity-actions";
import type {
  CreateJobActionResult,
  NewJobFormInput,
  UpdateContactActionResult,
  UpdateContactInput,
} from "../form-types";

// Server actions for the customer profile page (Stage 14 / Phase B1). The one
// write B1 owns on this surface is the customer's standing notes — the pinned,
// editable context block (gate code, "prefers texts", etc.) rendered by
// EditNotesForm. Distinct from a timeline note (addJobNote / AddNoteForm).
//
// Postgres-only: updateCustomerNotes is a no-op in sheet mode (no customers
// table), so { updated:false } surfaces back through EditNotesForm there. The
// page only renders this form when crmEnabled().

// Shape EditNotesForm's SaveNotesAction expects: { updated, error? }.
export type SaveNotesResult = { updated: boolean; error?: string };

// Persist one customer's standing notes. Mirrors the requireAdmin +
// checkLimit('admin-action', email) pattern from app/admin/jobs/[id]/actions.ts.
// The page binds `customerId`, so EditNotesForm only supplies `notes`.
export async function updateStandingNotes(
  customerId: string,
  notes: string,
): Promise<SaveNotesResult> {
  const auth = await requireAdmin();
  if (!auth) return { updated: false, error: "Not authorized" };

  const limit = await checkLimit("admin-action", auth.email);
  if (!limit.success) {
    return { updated: false, error: "Too many actions. Slow down a moment." };
  }

  // Cap at 2000 chars (shared freeTextSchema convention, lib/security/zod.ts).
  // Server actions are independently invokable, so the cap lives server-side.
  const capped = (notes ?? "").slice(0, 2000);

  const result = await updateCustomerNotes(customerId, capped);
  if (!result.updated) {
    return { updated: false, error: "Couldn’t save notes." };
  }

  // target = the customer id so the entry is attributable to this profile.
  await appendAuditRow({
    actor: adminActor(auth.email),
    action: ACTIONS.CUSTOMER_NOTES_UPDATED,
    target: customerId,
  });

  logger.info(
    { customerId, actor: auth.email },
    "admin: customer standing notes updated",
  );
  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  return { updated: true };
}

// Edit the customer's name / phone / email. Thin wrapper over the shared core
// (lib/crm/mutations.ts updateCustomerContact): admin gate + rate limit +
// revalidate. The core validates, refuses an email another customer has, and
// copies the change onto the customer's jobs.
export async function updateContactAction(
  customerId: string,
  input: UpdateContactInput,
): Promise<UpdateContactActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  if (!crmEnabled()) {
    return { ok: false, error: "Editing customers requires the Postgres backend." };
  }

  const res = await updateCustomerContact({
    customerId,
    changes: { name: input.name, phone: input.phone, email: input.email },
    actor: adminActor(auth.email),
  });
  if (!res.ok) {
    return { ok: false, error: res.error, duplicateId: res.duplicate?.existingId };
  }
  if (res.changed.length > 0) {
    revalidatePath(`/admin/customers/${customerId}`);
    revalidatePath("/admin/customers");
    revalidatePath("/admin/pipeline");
  }
  return { ok: true, message: res.message };
}

// Add a job for this customer, optionally scheduled. The form sends an Eastern
// date + start time + length; the server turns that into instants so the
// browser's own time zone never matters.
export async function createJobAction(
  customerId: string,
  input: NewJobFormInput,
): Promise<CreateJobActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  if (!crmEnabled()) {
    return { ok: false, error: "Adding jobs requires the Postgres backend." };
  }

  let schedule: { startsAt: string; endsAt: string; emailCustomer: boolean } | undefined;
  if (input.schedule) {
    const window = easternWindow(input.schedule);
    if (!window) return { ok: false, error: "Pick a date, a start time and a length." };
    schedule = { ...window, emailCustomer: input.schedule.emailCustomer !== false };
  }

  const res = await createJobForCustomer({
    customerId,
    job: {
      serviceType: input.serviceType,
      address: input.address,
      description: input.description,
      preferredDate: input.schedule ? input.schedule.date : input.preferredDate,
      urgency: input.urgency,
    },
    schedule,
    actor: adminActor(auth.email),
  });
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePath(`/admin/customers/${customerId}`);
  revalidatePath("/admin/customers");
  revalidatePath("/admin/pipeline");
  return {
    ok: true,
    jobId: res.jobId,
    scheduled: Boolean(res.scheduled),
    scheduleError: res.scheduleError,
    message: res.message,
  };
}
