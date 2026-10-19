import { appendAuditRow, findRowByJobId, updateRowByJobId } from "@/lib/data";
import { ACTIONS } from "@/lib/data/activity-actions";
import { sendReviewRequestEmail } from "@/lib/email/review-request";
import { reviewCityFrom, reviewServiceLabel } from "@/lib/reviews/request-fields";
import { logger, maskEmail } from "@/lib/security/logger";

// Ask a customer for a Google review now, from the job page or Claude. Closing
// a job out already asks (the completion or payment receipt carries the
// review link, and the daily review cron catches any that failed); this is
// for the rest: a resend, a job closed out another way, a customer who asked
// for the link. Same email the cron sends; stamps review_sent_at so the cron
// won't ask again. Refused for a customer who unsubscribed.
export type RequestReviewResult =
  | { ok: true; sentTo: string; sendCount: number; message: string }
  | { ok: false; error: string };

export async function requestReview(args: { jobId: string; actor: string }): Promise<RequestReviewResult> {
  const { jobId, actor } = args;
  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };
  const row = found.row;
  if (!row.email) return { ok: false, error: "There's no email on this job to send the review request to." };
  if ((row.opt_out || "").trim().toLowerCase() === "true") {
    return { ok: false, error: "This customer unsubscribed from these emails, so no review request was sent." };
  }

  await sendReviewRequestEmail({
    toEmail: row.email,
    toName: row.name || "",
    serviceLabel: reviewServiceLabel(row),
    customerCity: reviewCityFrom(row.address || ""),
  });
  const sendCount = (Number(row.review_send_count || "0") || 0) + 1;
  await updateRowByJobId(jobId, {
    review_sent_at: new Date().toISOString(),
    review_send_count: String(sendCount),
  });
  await appendAuditRow({
    actor,
    action: ACTIONS.REVIEW_REQUESTED,
    target: jobId,
    jobId,
    notes: sendCount > 1 ? `Review request #${sendCount}.` : "Review request sent.",
  });
  logger.info({ jobId, actor, maskedEmail: maskEmail(row.email), sendCount }, "crm: review requested");
  return {
    ok: true,
    sentTo: row.email,
    sendCount,
    message: `Review request emailed to ${row.email}.`,
  };
}
