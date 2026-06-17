"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { logger } from "@/lib/security/logger";
import { checkLimit } from "@/lib/security/rate-limit";
import {
  addJobNote,
  appendAuditRow,
  findRowByJobId,
  getAppointmentByJobId,
  updateRowByJobId,
} from "@/lib/data";
import { performCancellation } from "@/lib/scheduling/cancel";
import { adminActor } from "@/lib/data/activity-actions";
import { getBackend } from "@/lib/data/backend";
import { canAdminTransition } from "@/lib/jobs/status-machine";
import {
  claimChargeAttempt,
  findLiveAttempt,
  recordPaymentOutcome,
} from "@/lib/data/pg/payments";
import { chargeBalance, type ChargeBalanceResult } from "@/lib/stripe/charges";
import { dispatchJobToDavid } from "@/lib/telegram/dispatch";

// The deterministic Stripe idempotency key chargeBalance uses; also the
// payments.purpose for the guard row.
const BALANCE_PURPOSE = "balance-charge";

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
  if (before === newStatus) return { ok: true, message: "No change." };
  // Integrity guard (Phase B2): block dangerous human transitions — notably
  // hand-setting 'Complete' (which would bypass markComplete's balance charge).
  // Webhook status writes bypass this; they call updateRowByJobId directly.
  if (!canAdminTransition(before, newStatus)) {
    return {
      ok: false,
      error:
        newStatus === "Complete"
          ? "Use “Mark Complete” to complete a job — it charges the saved-card balance."
          : `Can't move a job from “${before}” to “${newStatus}”.`,
    };
  }
  await updateRowByJobId(jobId, { status: newStatus });
  await appendAuditRow({
    actor: auth.email,
    action: "job.status_changed",
    target: jobId,
    jobId,
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

export async function dispatchToDavid(jobId: string): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };

  try {
    const result = await dispatchJobToDavid(found.row);
    if (!result.ok) {
      return {
        ok: false,
        error:
          result.reason === "no-chat-id"
            ? "David's Telegram chat ID isn't configured yet."
            : "Couldn't send the Telegram message — check the bot config.",
      };
    }
    await updateRowByJobId(jobId, {
      dispatch_status: "Dispatched",
      dispatch_decision: "",
      dispatch_decided_at: "",
      telegram_message_id: result.messageId ? String(result.messageId) : "",
    });
    await appendAuditRow({
      actor: auth.email,
      action: "dispatch.sent",
      target: jobId,
      jobId,
      after: JSON.stringify({ messageId: result.messageId }),
      notes: "Manual re-dispatch from admin.",
    });
    logger.info({ jobId, actor: auth.email }, "admin: re-dispatched to David");
    revalidatePath(`/admin/jobs/${jobId}`);
    return { ok: true, message: "Sent to David's Telegram." };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "admin", action: "dispatchToDavid" },
    });
    logger.error({ err, jobId }, "admin: dispatchToDavid threw");
    return { ok: false, error: "Dispatch failed — see Sentry." };
  }
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
    jobId,
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
  const hasBalanceToCharge =
    balanceCents > 0 && Boolean(customerId) && Boolean(paymentMethodId);

  // POSTGRES guarded path. The payments table is the DURABLE double-charge
  // guard (Stripe idempotency keys expire at 24h, then re-charge). On a
  // synchronous success it writes Complete immediately, so a job never strands
  // charged-but-open if the webhook is delayed or lost; the
  // payment_intent.succeeded webhook is an idempotent backstop that re-confirms
  // Complete and reconciles the payments row. A 3DS (requires_action) charge
  // can't complete synchronously — its guard row is held until the webhook
  // resolves it.
  if (hasBalanceToCharge && getBackend() === "postgres") {
    return chargeBalanceGuarded({
      jobId,
      balanceCents,
      customerId,
      paymentMethodId,
      serviceType: found.row.service_type || "",
      customerEmail: found.row.email || "",
      adminEmail: auth.email,
    });
  }

  // LEGACY path — unchanged pre-B2 behavior, used for sheet mode and for the
  // no-balance / no-saved-card cases. Here there is no balance-charge webhook
  // to own the transition, so markComplete writes Complete itself.
  let chargeResult: ChargeBalanceResult | null = null;
  if (hasBalanceToCharge) {
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
    jobId,
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

// The postgres double-charge-guarded balance charge. Claims a payments attempt
// (atomic gate), charges, records the outcome — and deliberately does NOT write
// status=Complete (the payment_intent.succeeded webhook owns that, so there's
// exactly one authoritative completer instead of a markComplete/webhook race).
async function chargeBalanceGuarded(args: {
  jobId: string;
  balanceCents: number;
  customerId: string;
  paymentMethodId: string;
  serviceType: string;
  customerEmail: string;
  adminEmail: string;
}): Promise<ActionResult> {
  const { jobId, balanceCents, customerId, paymentMethodId } = args;

  // 1. Claim the attempt. null => a live (pending|succeeded) attempt already
  //    exists — we must NOT charge again.
  const claimed = await claimChargeAttempt({
    jobId,
    purpose: BALANCE_PURPOSE,
    amountCents: balanceCents,
    idempotencyKey: `${BALANCE_PURPOSE}:${jobId}`,
    stripeCustomerId: customerId,
  });
  if (!claimed) {
    const existing = await findLiveAttempt(jobId, BALANCE_PURPOSE);
    if (existing?.status === "succeeded") {
      return { ok: true, message: "Balance already charged for this job." };
    }
    if (existing?.status === "requires_action") {
      return {
        ok: false,
        error:
          "This balance charge needs customer 3DS authentication — generate a hosted authentication link from Stripe. Don't re-run Mark Complete.",
      };
    }
    return {
      ok: false,
      error:
        "A balance charge for this job is already in progress. Give it a moment and refresh.",
    };
  }

  // 2. We own the attempt — charge.
  let chargeResult: ChargeBalanceResult;
  try {
    chargeResult = await chargeBalance(
      {
        jobId,
        customerId,
        paymentMethodId,
        amountCents: balanceCents,
        description: `Forge Handyman — balance for ${args.serviceType || "service"}`,
        customerEmail: args.customerEmail,
      },
      args.adminEmail,
    );
  } catch (err) {
    // Free the gate so a deliberate retry is possible; the deterministic Stripe
    // idempotency key still prevents a real double-charge within 24h.
    await recordPaymentOutcome(claimed.id, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => {});
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

  // 3. Record the outcome on the attempt row.
  if (chargeResult.status === "failed") {
    await recordPaymentOutcome(claimed.id, {
      status: "failed",
      error: chargeResult.failureMessage,
      stripePaymentIntentId: chargeResult.paymentIntentId ?? undefined,
    });
    return {
      ok: false,
      error: `Balance charge failed: ${chargeResult.failureMessage}`,
    };
  }
  if (chargeResult.status === "requires_action") {
    // 3DS in-flight. 'requires_action' is INSIDE the gate index, so the row
    // stays held (a re-claim is blocked) until the webhook resolves it to
    // succeeded/failed after the customer authenticates via the hosted link.
    await recordPaymentOutcome(claimed.id, {
      status: "requires_action",
      stripePaymentIntentId: chargeResult.paymentIntentId,
    });
    return {
      ok: false,
      error:
        "Charge needs customer authentication (3DS). Generate a hosted authentication link from Stripe.",
    };
  }

  // Succeeded (Stripe confirmed synchronously). Record the attempt best-effort
  // — a DB blip here must NOT surface as an error after a real charge — then
  // write Complete now so the job never strands as charged-but-open if the
  // webhook is delayed or lost (the Redis dedupe is at-most-once). The
  // payment_intent.succeeded webhook idempotently re-confirms Complete and
  // reconciles this row.
  await recordPaymentOutcome(claimed.id, {
    status: "succeeded",
    stripePaymentIntentId: chargeResult.paymentIntentId,
    stripeChargeId: chargeResult.chargeId ?? undefined,
  }).catch(() => {});
  await updateRowByJobId(jobId, {
    status: "Complete",
    complete_date: new Date().toISOString(),
    balance_owed_cents: "0",
  });
  await appendAuditRow({
    actor: args.adminEmail,
    action: "job.completed",
    target: jobId,
    jobId,
    after: "Complete",
    notes: `Balance ${balanceCents} cents charged (guarded)`,
  });
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin");
  return {
    ok: true,
    message: `Job marked complete. Balance of $${(balanceCents / 100).toFixed(2)} charged.`,
  };
}

// Append a free-form note to this job's activity timeline (a `note.added`
// activity, actor `admin:<email>`). Postgres-only timeline read surface; in
// sheet mode addJobNote records the note best-effort on the Audit tab. The job
// detail page binds jobId and passes the (text) -> result shape AddNoteForm
// expects.
export async function addJobNoteAction(
  jobId: string,
  text: string,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  // Cap at 2000 chars to match the shared freeTextSchema convention
  // (lib/security/zod.ts) — server actions are independently invokable, so the
  // cap belongs here, not just in the form.
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) return { ok: false, error: "Note can't be empty." };
  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };

  const { ok } = await addJobNote(jobId, adminActor(auth.email), trimmed);
  if (!ok) return { ok: false, error: "Couldn't save the note." };

  logger.info({ jobId, actor: auth.email }, "admin: job note added");
  revalidatePath(`/admin/jobs/${jobId}`);
  return { ok: true, message: "Note added." };
}

export async function cancelBooking(jobId: string): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  if (getBackend() !== "postgres") {
    return { ok: false, error: "Bookings are only available on the Postgres backend." };
  }

  const appt = await getAppointmentByJobId(jobId);
  if (!appt) return { ok: false, error: "No active booking found for this job." };

  const result = await performCancellation(appt.id, adminActor(auth.email));
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "already_cancelled"
          ? "That booking was already cancelled."
          : "Couldn't cancel the booking. Please try again.",
    };
  }

  logger.info({ jobId, actor: auth.email }, "admin: booking cancelled");
  revalidatePath(`/admin/jobs/${jobId}`);
  revalidatePath("/admin");
  return { ok: true, message: "Booking cancelled — the time slot is open again." };
}
