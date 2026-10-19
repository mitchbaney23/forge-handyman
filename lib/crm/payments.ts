import {
  appendAuditRow,
  findRowByJobId,
  getAppointmentByJobId,
  listActivitiesForJob,
  updateRowByJobId,
  type ContactRowPartial,
} from "@/lib/data";
import { extractQuoteMeta } from "@/lib/automation/lifecycle";
import { getBackend } from "@/lib/data/backend";
import { ACTIONS } from "@/lib/data/activity-actions";
import { recordPayment } from "@/lib/data/pg/payments";
import { linkIdsFrom, MAX_BALANCE_CENTS } from "@/lib/crm/mutations";
import { sendPaymentNotice } from "@/lib/email/office-notice";
import { sendPaymentReceiptEmail } from "@/lib/email/payment-receipt";
import { canAdminTransition } from "@/lib/jobs/status-machine";
import {
  METHOD_DETAIL_MAX,
  PAYMENT_METHODS,
  PAYMENT_NOTE_MAX,
  isDepositPayment,
  paymentMethodLabel,
  suggestBalanceAfter,
  type PaymentMethod,
} from "@/lib/payment-methods";
import { formatEtDay, formatEtTime } from "@/lib/scheduling/time";
import { logger } from "@/lib/security/logger";
import { deactivatePaymentLinks } from "@/lib/stripe/payment-links";

// ---------------------------------------------------------------------------
// Record a payment taken outside Stripe — cash, check, Venmo, Zelle, anything
// else — the same shape as the other CRM cores: no next/*, no session, an
// explicit actor; the admin action and the MCP tool own auth and rate limits.
//
// What it does, in order:
//   1. writes the payments ledger (purpose "manual", the method and note in
//      its data), so it counts toward Total spent and the month's revenue;
//   2. sets the balance owed (suggested from the quote / current balance, or
//      as the sender gives it) and moves the job: a first payment on an
//      unbooked job is its deposit (-> Booked); "close out" with nothing left
//      owed marks it Complete;
//   3. switches off every Stripe link the job has emailed (quote and balance
//      links), because their amounts are stale and paying one would charge
//      the customer twice;
//   4. emails the office, and optionally the customer a receipt — which asks
//      for a Google review when the payment closes the job out.
// Steps 3 and 4 are best-effort and reported; the payment stands either way.
// Nothing here charges a card: Mark Complete with a $0 balance charges nothing.
// ---------------------------------------------------------------------------

export type ReceiptOutcome = "sent" | "failed" | "no-email" | "skipped";

export type RecordPaymentResult =
  | {
      ok: true;
      kind: "deposit" | "balance";
      balanceAfterCents: number;
      statusAfter: string;
      closedOut: boolean;
      linksClosed: number;
      linksError?: string;
      receipt: ReceiptOutcome;
      reviewRequested: boolean;
      message: string;
    }
  | { ok: false; error: string };

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function recordManualPayment(args: {
  jobId: string;
  amountCents: number;
  method: PaymentMethod;
  // "Other": what it was (Cash App, a gift card). Check: the check number.
  methodDetail?: string;
  note?: string;
  // The balance owed after this payment; defaults to the suggestion.
  balanceAfterCents?: number;
  // Mark the job Complete (only with nothing left owed).
  closeOut?: boolean;
  // Email the customer a receipt. Default true.
  emailCustomer?: boolean;
  actor: string;
}): Promise<RecordPaymentResult> {
  const { jobId, amountCents, method, actor } = args;
  if (!Number.isInteger(amountCents) || amountCents < 1) {
    return { ok: false, error: "Enter the amount they paid." };
  }
  if (amountCents > MAX_BALANCE_CENTS) {
    return { ok: false, error: `A payment can't be more than ${dollars(MAX_BALANCE_CENTS)}.` };
  }
  if (!PAYMENT_METHODS.includes(method)) {
    return { ok: false, error: "Pick how they paid." };
  }
  const methodDetail = (args.methodDetail ?? "").trim().slice(0, METHOD_DETAIL_MAX);
  if (method === "other" && !methodDetail) {
    return { ok: false, error: "Say how they paid (for example Cash App or a gift card)." };
  }
  const note = (args.note ?? "").trim().slice(0, PAYMENT_NOTE_MAX);
  if (getBackend() !== "postgres") {
    return { ok: false, error: "Recording payments needs the Postgres backend." };
  }

  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };
  const row = found.row;
  const statusBefore = (row.status || "").trim();
  const depositPaidCents = Number(row.deposit_paid_cents || "0") || 0;
  const balanceBeforeCents = Number(row.balance_owed_cents || "0") || 0;

  const activities = await listActivitiesForJob(jobId);
  const lastQuote = extractQuoteMeta(activities);
  const lastQuoteTotalCents =
    lastQuote && lastQuote.depositCents != null
      ? lastQuote.depositCents + (lastQuote.balanceCents ?? 0)
      : null;

  const job = { status: statusBefore, depositPaidCents, balanceOwedCents: balanceBeforeCents, lastQuoteTotalCents };
  const kind: "deposit" | "balance" = isDepositPayment(job) ? "deposit" : "balance";
  const balanceAfterCents = args.balanceAfterCents ?? suggestBalanceAfter({ ...job, amountCents });
  if (!Number.isInteger(balanceAfterCents) || balanceAfterCents < 0 || balanceAfterCents > MAX_BALANCE_CENTS) {
    return { ok: false, error: "The balance left must be $0 or more." };
  }
  if (args.closeOut && balanceAfterCents > 0) {
    return {
      ok: false,
      error: `Closing the job out needs nothing left owed; the balance would be ${dollars(balanceAfterCents)}.`,
    };
  }

  const closedOut = Boolean(args.closeOut) && statusBefore !== "Complete";
  let statusAfter = statusBefore;
  if (closedOut) statusAfter = "Complete";
  else if (kind === "deposit" && canAdminTransition(statusBefore || "New", "Booked")) statusAfter = "Booked";

  const methodLabel = paymentMethodLabel(method, methodDetail);

  // 1. The ledger: the record that makes it count.
  await recordPayment({
    jobId,
    purpose: "manual",
    status: "succeeded",
    amountCents,
    data: { method, ...(methodDetail ? { methodDetail } : {}), kind, ...(note ? { note } : {}), actor },
  });

  // 2. The job.
  const now = new Date().toISOString();
  const patch: ContactRowPartial = { balance_owed_cents: String(balanceAfterCents) };
  if (kind === "deposit") patch.deposit_paid_cents = String(amountCents);
  if (statusAfter !== statusBefore) patch.status = statusAfter;
  if (closedOut && !row.complete_date) patch.complete_date = now;
  await updateRowByJobId(jobId, patch);

  await appendAuditRow({
    actor,
    action: ACTIONS.PAYMENT_RECORDED,
    target: jobId,
    jobId,
    notes: [
      `${methodLabel} ${dollars(amountCents)}${kind === "deposit" ? " (deposit)" : ""}.`,
      `Balance ${dollars(balanceBeforeCents)} → ${dollars(balanceAfterCents)}.`,
      note,
    ]
      .filter(Boolean)
      .join(" "),
  });
  if (statusAfter !== statusBefore) {
    await appendAuditRow({
      actor,
      action: closedOut ? ACTIONS.JOB_COMPLETED : ACTIONS.JOB_STATUS_CHANGED,
      target: jobId,
      jobId,
      before: statusBefore,
      after: statusAfter,
      ...(closedOut ? { notes: `Closed out with a ${methodLabel.toLowerCase()} payment; nothing charged.` } : {}),
    });
  }
  logger.info({ jobId, actor, method, amountCents, balanceAfterCents, statusAfter }, "crm: payment recorded");

  // 3. Switch off every emailed Stripe link: its amount is stale now.
  const linkIds = [...linkIdsFrom(activities, ACTIONS.QUOTE_SENT), ...linkIdsFrom(activities, "balance_link.created")];
  let linksClosed = 0;
  let linksError: string | undefined;
  if (linkIds.length > 0) {
    try {
      await deactivatePaymentLinks(linkIds, actor);
      linksClosed = linkIds.length;
    } catch (err) {
      linksError = "Couldn't switch off the job's Stripe payment links; turn them off in Stripe so they can't be paid twice.";
      logger.warn({ err, jobId, linkIds }, "crm: payment links not deactivated (non-fatal)");
    }
  }

  // 4. Emails. The receipt asks for a review when the job is done and paid
  // up, unless one was already asked or the customer opted out.
  const fullyPaidAndDone = statusAfter === "Complete" && balanceAfterCents === 0;
  const optedOut = (row.opt_out || "").trim().toLowerCase() === "true";
  const reviewAsk = fullyPaidAndDone && !(row.review_sent_at || "").trim() && !optedOut;
  let receipt: ReceiptOutcome = "skipped";
  let reviewRequested = false;
  if (args.emailCustomer !== false) {
    if (!row.email) {
      receipt = "no-email";
    } else {
      try {
        await sendPaymentReceiptEmail({
          toEmail: row.email,
          toName: row.name,
          serviceType: row.service_type,
          amountCents,
          methodLabel,
          balanceAfterCents,
          reviewAsk,
        });
        receipt = "sent";
        if (reviewAsk) {
          reviewRequested = true;
          await updateRowByJobId(jobId, {
            review_sent_at: now,
            review_send_count: String((Number(row.review_send_count || "0") || 0) + 1),
          });
          await appendAuditRow({
            actor,
            action: ACTIONS.REVIEW_REQUESTED,
            target: jobId,
            jobId,
            notes: "Google review link in the payment receipt.",
          });
        }
      } catch (err) {
        receipt = "failed";
        logger.warn({ err, jobId }, "crm: payment receipt failed (non-fatal)");
      }
    }
  }

  let appointmentLabel: string | undefined;
  try {
    const appt = await getAppointmentByJobId(jobId);
    if (appt) {
      const starts = new Date(appt.startsAt);
      appointmentLabel = `${formatEtDay(starts)} · ${formatEtTime(starts)}`;
    }
  } catch {
    // label only
  }
  try {
    await sendPaymentNotice({
      jobId,
      kind,
      customerName: row.name,
      customerEmail: row.email,
      serviceType: row.service_type,
      amountPaidCents: amountCents,
      balanceCents: balanceAfterCents,
      appointmentLabel,
      cardSaved: false,
      recorded: { methodLabel, actor, statusAfter, note: note || undefined, linksClosed, receipt },
    });
  } catch (err) {
    logger.warn({ err, jobId }, "crm: payment office notice failed (non-fatal)");
  }

  const parts = [
    `Recorded ${methodLabel.toLowerCase()} ${dollars(amountCents)}.`,
    balanceAfterCents > 0 ? `Balance now ${dollars(balanceAfterCents)}.` : "Paid in full.",
    statusAfter !== statusBefore ? `Job moved to ${statusAfter}.` : "",
    linksClosed > 0 ? `Closed ${linksClosed} Stripe link${linksClosed === 1 ? "" : "s"}.` : "",
    linksError ?? "",
    receipt === "sent"
      ? `Receipt emailed${reviewRequested ? " with a Google review request" : ""}.`
      : receipt === "failed"
        ? "The receipt email failed."
        : receipt === "no-email"
          ? "No email on file, so no receipt."
          : "",
  ];
  return {
    ok: true,
    kind,
    balanceAfterCents,
    statusAfter,
    closedOut,
    linksClosed,
    ...(linksError ? { linksError } : {}),
    receipt,
    reviewRequested,
    message: parts.filter(Boolean).join(" "),
  };
}
