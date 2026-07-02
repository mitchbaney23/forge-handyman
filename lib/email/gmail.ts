import { google } from "googleapis";
import type { JWT } from "google-auth-library";

// Shared Gmail send-as plumbing for outbound email modules. The older email
// modules (quote, review-request, deposit/completion receipts) self-contain
// copies of these helpers; new modules should import from here instead of
// stamping out another copy.

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

export function getBusinessEmail(): string {
  const email = process.env.BUSINESS_EMAIL;
  if (!email) throw new Error("BUSINESS_EMAIL is not configured");
  return email;
}

function getAuth(): JWT {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set",
    );
  }
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
    subject: getBusinessEmail(),
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// RFC 2047 encoded-word for non-ASCII subject headers (mojibake guard).
function encodeMimeHeader(value: string): string {
  if (!value) return value;
  if (Array.from(value).every((ch) => ch.charCodeAt(0) <= 0x7f)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf-8").toString("base64")}?=`;
}

function encodeRfc2822(message: {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const boundary = `----=_Boundary_${Date.now()}`;
  const lines = [
    `To: ${message.to}`,
    `From: ${message.from}`,
    `Reply-To: ${message.replyTo}`,
    `Subject: ${encodeMimeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    message.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    message.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendGmail(message: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });
  const businessEmail = getBusinessEmail();
  const raw = encodeRfc2822({
    to: message.to,
    from: businessEmail,
    replyTo: businessEmail,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

// The brand shell every customer-facing email shares: navy header, white card,
// gray footer with the CAN-SPAM address. Pass pre-escaped/pre-built body HTML.
export function brandShell(bodyHtml: string, mailingAddress: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f8f9fa;font-family:Inter,Arial,sans-serif;color:#1f2937;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:24px 0;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td style="background:#1B2A4A;padding:20px 28px;">
              <span style="font-size:16px;font-weight:700;color:#ffffff;">Forge Handyman Service</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">${bodyHtml}</td>
          </tr>
          <tr>
            <td style="background:#F3F4F6;padding:16px 28px;font-size:11px;color:#6b7280;text-align:center;line-height:1.5;">
              Forge Handyman Service · Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs &amp; Fuquay-Varina, NC<br/>
              ${escapeHtml(mailingAddress)}
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
