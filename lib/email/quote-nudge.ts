import { BUSINESS } from "@/lib/constants";
import { brandShell, escapeHtml, sendGmail } from "@/lib/email/gmail";

// "Your quote expires soon" nudge, sent once by the daily lifecycle cron when
// a quote's link is 24-48h from the expiry date the quote email promised.
// paymentLinkUrl comes from the quote.sent activity payload; quotes sent
// before that payload existed get the no-button fallback copy.

export interface QuoteNudgeInput {
  toEmail: string;
  toName: string;
  serviceType: string;
  expiresAt: string;
  paymentLinkUrl: string;
  depositCents: number | null;
}

function firstNameOf(name: string): string {
  return (name || "there").split(/\s+/)[0] || "there";
}

function expiresLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "soon";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

export async function sendQuoteNudgeEmail(data: QuoteNudgeInput): Promise<void> {
  const expires = expiresLabel(data.expiresAt);
  const deposit =
    data.depositCents !== null
      ? `$${(data.depositCents / 100).toFixed(2)}`
      : null;

  const ctaHtml = data.paymentLinkUrl
    ? `<div style="margin:0 0 16px;">
         <a href="${data.paymentLinkUrl}" style="display:inline-block;background:#D97706;color:#ffffff;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">
           Pay the deposit${deposit ? ` (${deposit})` : ""} &rarr;
         </a>
       </div>`
    : `<p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.55;">
         Just reply to this email and we'll send you a fresh payment link.
       </p>`;

  const html = brandShell(
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(firstNameOf(data.toName))},</p>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
       Just a heads-up — your quote for the
       <strong>${escapeHtml(data.serviceType)}</strong> job expires on
       <strong>${escapeHtml(expires)}</strong>. Locking it in only takes a minute:
     </p>
     ${ctaHtml}
     <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.55;">
       Want to change the scope, or have questions first? Reply here and we'll
       sort it out — no pressure either way.
     </p>
     <p style="margin:24px 0 0;font-size:14px;color:#374151;">&mdash; The Forge team</p>`,
    BUSINESS.mailingAddress,
  );

  const text = [
    `Hi ${firstNameOf(data.toName)},`,
    "",
    `Just a heads-up — your quote for the ${data.serviceType} job expires on ${expires}.`,
    "",
    data.paymentLinkUrl
      ? `Pay the deposit${deposit ? ` (${deposit})` : ""}: ${data.paymentLinkUrl}`
      : "Just reply to this email and we'll send you a fresh payment link.",
    "",
    "Want to change the scope, or have questions first? Reply here and we'll sort it out — no pressure either way.",
    "",
    "— The Forge team",
    "",
    BUSINESS.mailingAddress,
  ].join("\n");

  await sendGmail({
    to: data.toEmail,
    subject: `Your Forge Handyman quote expires ${expires}`,
    html,
    text,
  });
}
