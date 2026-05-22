import { google } from "googleapis";
import type { JWT } from "google-auth-library";

export type ContactSubmission = {
  name: string;
  phone: string;
  email: string;
  address: string;
  serviceType: string;
  preferredDate: string;
  description: string;
  referralSource: string;
  submittedAt: string;
};

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
];

function getBusinessEmail(): string {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildEmailHtml(data: ContactSubmission): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-weight:600;width:180px;">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#1f2937;">${escapeHtml(value) || "&mdash;"}</td>
    </tr>
  `;

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f8f9fa;font-family:Inter,Arial,sans-serif;color:#1f2937;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:24px 0;">
      <tr>
        <td align="center">
          <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
            <tr>
              <td style="background:#1B3A5C;padding:24px 28px;color:#ffffff;">
                <div style="font-size:12px;text-transform:uppercase;letter-spacing:2px;color:#F59E0B;">Forge Handyman Service</div>
                <div style="font-size:22px;font-weight:700;margin-top:6px;">New Job Request</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <div style="padding:16px;background:#FFF7ED;border-left:4px solid #D97706;border-radius:4px;margin-bottom:20px;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#9A3412;font-weight:600;">Call back at</div>
                  <a href="tel:${escapeHtml(data.phone)}" style="font-size:22px;font-weight:700;color:#1B3A5C;text-decoration:none;">${escapeHtml(data.phone)}</a>
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
                  ${row("Name", data.name)}
                  ${row("Phone", data.phone)}
                  ${row("Email", data.email)}
                  ${row("Address", data.address)}
                  ${row("Service", data.serviceType)}
                  ${row("Preferred Date", data.preferredDate)}
                  ${row("Referral Source", data.referralSource)}
                  ${row("Submitted", data.submittedAt)}
                </table>
                <div style="margin-top:20px;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;margin-bottom:8px;">Description of Work</div>
                  <div style="padding:14px;background:#F3F4F6;border-radius:6px;white-space:pre-wrap;">${escapeHtml(data.description)}</div>
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:#F3F4F6;padding:16px 28px;font-size:12px;color:#6b7280;text-align:center;">
                Submitted via forgehandyman.com contact form
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildEmailText(data: ContactSubmission): string {
  return [
    "New Job Request — Forge Handyman Service",
    "",
    `Name: ${data.name}`,
    `Phone: ${data.phone}`,
    `Email: ${data.email}`,
    `Address: ${data.address}`,
    `Service: ${data.serviceType}`,
    `Preferred Date: ${data.preferredDate}`,
    `Referral Source: ${data.referralSource}`,
    `Submitted: ${data.submittedAt}`,
    "",
    "Description of Work:",
    data.description,
    "",
    "— Submitted via forgehandyman.com",
  ].join("\n");
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
    `Subject: ${message.subject}`,
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

export async function sendNotificationEmail(data: ContactSubmission): Promise<void> {
  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });
  const businessEmail = getBusinessEmail();

  const raw = encodeRfc2822({
    to: businessEmail,
    from: businessEmail,
    replyTo: data.email || businessEmail,
    subject: `New Job Request: ${data.serviceType} — ${data.name}`,
    html: buildEmailHtml(data),
    text: buildEmailText(data),
  });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw },
  });
}

export async function createCalendarEvent(data: ContactSubmission): Promise<void> {
  const auth = getAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new Error("GOOGLE_CALENDAR_ID is not configured");

  const start = buildEventStart(data.preferredDate);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const description = [
    `Customer: ${data.name}`,
    `Phone: ${data.phone}`,
    `Email: ${data.email}`,
    `Address: ${data.address}`,
    `Referral: ${data.referralSource}`,
    "",
    "Description of Work:",
    data.description,
  ].join("\n");

  await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `${data.serviceType} — ${data.name}`,
      description,
      location: data.address,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 30 }],
      },
    },
  });
}

function buildEventStart(preferredDate: string): Date {
  // Default to 9:00 AM local time on the requested day.
  const parsed = new Date(`${preferredDate}T09:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + 1);
    fallback.setHours(9, 0, 0, 0);
    return fallback;
  }
  return parsed;
}

// Sheet writes moved to lib/sheet/repo.ts in Stage 2 — the contact form now
// calls appendContactRow there. Gmail + Calendar helpers remain here.
