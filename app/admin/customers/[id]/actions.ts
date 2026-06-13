"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { logger } from "@/lib/security/logger";
import { checkLimit } from "@/lib/security/rate-limit";
import { appendAuditRow, updateCustomerNotes } from "@/lib/data";
import { adminActor } from "@/lib/data/activity-actions";

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

async function requireAdmin(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email || !isAllowlistedEmail(email)) return null;
  return { email };
}

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

  // Free-form action string (not in the closed ACTIONS vocabulary — the column
  // is text and the timeline renders unknowns generically). target = the
  // customer id so the entry is attributable to this profile.
  await appendAuditRow({
    actor: adminActor(auth.email),
    action: "customer.notes_updated",
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
