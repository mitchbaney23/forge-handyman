"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { logger } from "@/lib/security/logger";
import { checkLimit } from "@/lib/security/rate-limit";
import { appendAuditRow } from "@/lib/sheet/audit-log";
import { findRowByJobId, updateRowByJobId } from "@/lib/sheet/repo";
import { chargeBalance, type ChargeBalanceResult } from "@/lib/stripe/charges";

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email || !isAllowlistedEmail(email)) return null;
  return { email };
}

async function rateLimitAdmin(email: string): Promise<boolean> {
  const result = await checkLimit("admin-action", email);
  return result.success;
}

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

export async function updateJobStatus(
  jobId: string,
  newStatus: string,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  if (!VALID_STATUSES.has(newStatus)) {
    return { ok: false, error: `Invalid status: ${newStatus}` };
  }
  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };

  const before = found.row.status;
  await updateRowByJobId(jobId, { status: newStatus });
  await appendAuditRow({
    actor: auth.email,
    action: "job.status_changed",
    target: jobId,
    before,
    after: newStatus,
  });
  logger.info(
    { jobId, actor: auth.email, from: before, to: newStatus },
    "admin: status changed",
  );
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin");
  return { ok: true, message: `Status set to ${newStatus}.` };
}

export async function recordFirstTouch(jobId: string): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };
  if (found.row.first_touch_sent_at) {
    return { ok: false, error: "First touch already recorded." };
  }
  const now = new Date().toISOString();
  await updateRowByJobId(jobId, { first_touch_sent_at: now });
  await appendAuditRow({
    actor: auth.email,
    action: "job.first_touch_recorded",
    target: jobId,
    after: now,
  });
  revalidatePath(`/admin/jobs/${jobId}`);
  return { ok: true, message: "First touch recorded." };
}

export async function markComplete(jobId: string): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };
  if (found.row.status === "Complete") {
    return { ok: false, error: "Job is already marked complete." };
  }

  const balanceCents = Number(found.row.balance_owed_cents || "0");
  const customerId = found.row.stripe_customer_id || "";
  const paymentMethodId = found.row.stripe_payment_method_id || "";

  // If there's a balance owed AND we have a saved card, charge it.
  let chargeResult: ChargeBalanceResult | null = null;
  if (balanceCents > 0 && customerId && paymentMethodId) {
    try {
      chargeResult = await chargeBalance(
        {
          jobId,
          customerId,
          paymentMethodId,
          amountCents: balanceCents,
          description: `Forge Handyman — balance for ${found.row.service_type || "service"}`,
          customerEmail: found.row.email || "",
        },
        auth.email,
      );
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: "admin", action: "markComplete" },
        extra: { jobId },
      });
      logger.error({ err, jobId }, "admin: chargeBalance threw");
      return {
        ok: false,
        error: "Couldn't charge the balance — see Sentry for details.",
      };
    }

    if (chargeResult.status === "failed") {
      return {
        ok: false,
        error: `Balance charge failed: ${chargeResult.failureMessage}`,
      };
    }
    if (chargeResult.status === "requires_action") {
      return {
        ok: false,
        error:
          "Charge needs customer authentication (3DS). Generate a hosted authentication link from Stripe.",
      };
    }
  }

  const now = new Date().toISOString();
  await updateRowByJobId(jobId, {
    status: "Complete",
    complete_date: now,
    ...(chargeResult?.status === "succeeded"
      ? { balance_owed_cents: "0" }
      : {}),
  });
  await appendAuditRow({
    actor: auth.email,
    action: "job.completed",
    target: jobId,
    before: found.row.status,
    after: "Complete",
    notes: chargeResult
      ? `Balance ${balanceCents} cents — charge ${chargeResult.status}`
      : balanceCents > 0
        ? `Balance ${balanceCents} cents NOT charged (missing Stripe customer/payment method)`
        : undefined,
  });
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin");

  const balanceMessage =
    chargeResult?.status === "succeeded"
      ? ` Balance of $${(balanceCents / 100).toFixed(2)} charged.`
      : balanceCents > 0 && !customerId
        ? " (No saved card — collect balance manually.)"
        : "";

  return {
    ok: true,
    message: `Job marked complete.${balanceMessage}`,
  };
}
