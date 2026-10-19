import { BUSINESS } from "@/lib/constants";
import { brandShell, escapeHtml, sendGmail } from "@/lib/email/gmail";
import { getGoogleReviewUrl } from "@/lib/reviews/google";
import { REVIEW_SIGN_OFF, reviewAskCopy } from "@/lib/reviews/review-ask-copy";

// "We received your payment" receipt for a payment taken outside Stripe
// (cash, check, Venmo, Zelle) and recorded by hand. Stripe sends its own
// receipts for card payments; this is the customer's only record of the rest.
// When the payment closes the job out, it doubles as the Google review ask
// (the caller stamps review_sent_at so the review cron doesn't ask again).

export interface PaymentReceiptInput {
  toEmail: string;
  toName: string;
  serviceType: string;
  amountCents: number;
  methodLabel: string; // "Cash", "Check #1043"
  balanceAfterCents: number;
  reviewAsk: boolean;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function firstNameOf(name: string): string {
  return (name || "there").split(/\s+/)[0] || "there";
}

export function buildPaymentReceipt(data: PaymentReceiptInput): {
  subject: string;
  html: string;
  text: string;
} {
  const amount = dollars(data.amountCents);
  const service = data.serviceType || "your job";
  const method = data.methodLabel.toLowerCase().startsWith("other")
    ? "payment"
    : `${data.methodLabel} payment`;
  const balanceLine =
    data.balanceAfterCents > 0
      ? `Remaining balance: ${dollars(data.balanceAfterCents)}.`
      : "You're paid in full.";
  const reviewUrl = getGoogleReviewUrl();
  const review = reviewAskCopy();
  // The review block opens with its own thank-you; don't say it twice.
  const received = `We received your ${method} of ${amount} for ${service}.${data.reviewAsk ? "" : " Thank you."}`;

  const html = brandShell(
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(firstNameOf(data.toName))},</p>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">${escapeHtml(received)}</p>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">${escapeHtml(balanceLine)}</p>
     ${
       data.reviewAsk
         ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${escapeHtml(review.opening)}</p>
     <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${escapeHtml(review.ask)}</p>
     <div style="margin:0 0 16px;">
       <a href="${reviewUrl}" style="display:inline-block;background:#D97706;color:#ffffff;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">Leave a Google review &rarr;</a>
     </div>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">${escapeHtml(review.closing)}</p>
     <p style="margin:0;font-size:15px;color:#374151;">${escapeHtml(REVIEW_SIGN_OFF)}</p>`
         : `<p style="margin:0;font-size:14px;color:#374151;line-height:1.55;">Questions? Reply to this email or call ${escapeHtml(BUSINESS.phone)}.</p>`
     }`,
    BUSINESS.mailingAddress,
  );

  const text = [
    `Hi ${firstNameOf(data.toName)},`,
    "",
    received,
    "",
    balanceLine,
    "",
    ...(data.reviewAsk
      ? [review.opening, "", review.ask, reviewUrl, "", review.closing, "", REVIEW_SIGN_OFF]
      : [`Questions? Reply to this email or call ${BUSINESS.phone}.`]),
    "",
    `Forge Handyman Service · ${BUSINESS.mailingAddress}`,
  ].join("\n");

  return {
    subject: `Payment received: ${amount} — Forge Handyman`,
    html,
    text,
  };
}

export async function sendPaymentReceiptEmail(data: PaymentReceiptInput): Promise<void> {
  await sendGmail({ to: data.toEmail, ...buildPaymentReceipt(data) });
}
