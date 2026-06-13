"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { logger, maskEmail } from "@/lib/security/logger";
import { checkLimit } from "@/lib/security/rate-limit";
import {
  appendAuditRow,
  findPriorJobsByEmail,
  redactCustomerByEmail,
  redactJobLegacyByIds,
  updateRowByJobId,
  type ContactRowPartial,
} from "@/lib/data";

const REDACTED = "[REDACTED]";

// Columns wiped on anonymization. We KEEP non-PII columns (submitted_at,
// service_type, status, dates, financial totals, job_id) so the row stays
// usable for tax/accounting integrity per the 7-year retention rule — we
// anonymize rather than delete.
const ANONYMIZED_FIELDS: ContactRowPartial = {
  name: REDACTED,
  phone: REDACTED,
  email: REDACTED,
  address: REDACTED,
  description: REDACTED,
  utm_source: "",
  photo_urls: "",
};

export type DataRequestResult =
  | { ok: true; rowsAnonymized: number; message: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email || !isAllowlistedEmail(email)) return null;
  return { email };
}

export async function anonymizeCustomer(
  rawEmail: string,
): Promise<DataRequestResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized" };
  if (!(await checkLimit("admin-action", admin.email)).success) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }

  const email = (rawEmail || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid customer email address." };
  }

  try {
    const { rows } = await findPriorJobsByEmail(email);
    const targets = rows.filter((r) => Boolean(r.job_id));
    if (targets.length === 0) {
      return {
        ok: false,
        error: `No records found for ${email}. (Already anonymized, or never a customer.)`,
      };
    }

    let count = 0;
    const redactedJobIds: string[] = [];
    for (const row of targets) {
      if (!row.job_id) continue;
      await updateRowByJobId(row.job_id, ANONYMIZED_FIELDS);
      redactedJobIds.push(row.job_id);
      count += 1;
    }

    // Clear the migration's raw-row stash (postgres backend only — a no-op on
    // sheet). jobs.legacy holds the COMPLETE original sheet row incl. PII and
    // can't be reached via updateRowByJobId, so without this the customer's
    // original name/phone/email/address would survive the deletion request in
    // legacy AND be re-emitted daily in the backup CSV. Matched by the ids we
    // just redacted (email is already '[REDACTED]' on those rows now).
    const legacyRedaction = await redactJobLegacyByIds(redactedJobIds);

    // Also redact the normalized customer record (postgres backend only — a
    // no-op on sheet). This is the compliance path: a failure here must fail
    // the action, so it runs unguarded inside the surrounding try.
    const customerRedaction = await redactCustomerByEmail(email);

    await appendAuditRow({
      actor: admin.email,
      action: "data.anonymized",
      target: maskEmail(email),
      after: JSON.stringify({
        rowsAnonymized: count,
        legacyCleared: legacyRedaction.updated,
        customerRedacted: customerRedaction.updated,
      }),
      notes: "Customer data-deletion request — PII redacted, rows retained for tax compliance.",
    });
    logger.info(
      { actor: admin.email, maskedEmail: maskEmail(email), rowsAnonymized: count },
      "data-request: customer anonymized",
    );
    revalidatePath("/admin/data-requests");
    revalidatePath("/admin");

    return {
      ok: true,
      rowsAnonymized: count,
      message: `Anonymized ${count} record${count === 1 ? "" : "s"}. PII redacted; rows retained (anonymized) for tax compliance.`,
    };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "admin-data-requests", action: "anonymize" },
    });
    logger.error(
      { err, actor: admin.email, maskedEmail: maskEmail(email) },
      "data-request: anonymize failed",
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Anonymization failed",
    };
  }
}
