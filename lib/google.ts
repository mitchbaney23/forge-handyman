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
  // Optional context (Stage 6a): present on new-form submissions; absent
  // on legacy calls so existing callers continue to work.
  jobId?: string;
  propertyType?: string;
  urgency?: string;
  bestContactTime?: string;
  bestContactMethod?: string;
  isReturningCustomer?: boolean;
  priorJobCount?: number;
  duplicateLast24hCount?: number;
  photoUrls?: string[];
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

function escapeUrl(value: string): string {
  return encodeURIComponent(value);
}

// Prefer NEXTAUTH_URL (server-side, reliably canonical) over
// NEXT_PUBLIC_SITE_URL (which may have been set to a Vercel deployment URL).
// Fall back to the hardcoded canonical domain.
function getSiteUrl(): string {
  const candidates = [
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ].filter(
    (value): value is string =>
      typeof value === "string" &&
      value.length > 0 &&
      // Reject Vercel preview/deployment URLs — those aren't the canonical
      // domain even if someone accidentally set the env var to one.
      !/vercel\.app$/i.test(value),
  );
  return candidates[0] ?? "https://forgehandyman.com";
}

// Best-effort city extraction from a US-style street address.
// Handles both 3-part and 4-part formats Google Places returns:
//   "123 Main St, Garner, NC 27529"        -> "Garner"
//   "123 Main St, Clayton, NC 27520, USA"  -> "Clayton"
function extractCityFromAddress(address: string): string {
  if (!address) return "";
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Strip a trailing country segment if present so the city-index math
  // works for both "{street, city, state-zip}" and "{street, city, state-zip, country}".
  while (
    parts.length > 0 &&
    /^(USA|U\.S\.A\.|United States|US|U\.S\.)$/i.test(parts[parts.length - 1])
  ) {
    parts.pop();
  }
  if (parts.length === 0) return "";
  // Typical pattern after country strip: {street, city, state-zip}
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) return parts[1];
  // Single token (e.g., "Clayton") — return as-is
  return parts[0];
}

// MIME-encode a header value per RFC 2047 if it contains non-ASCII.
// Without this, em dash / curly quotes / etc. land as Latin-1 mojibake in
// Gmail's inbox preview (e.g., "—" rendered as "Ã¢Â€Â").
function encodeMimeHeader(value: string): string {
  if (!value) return value;
  // Pure ASCII — pass through.
  if (!/[^\u0000-\u007F]/.test(value)) return value;
  const base64 = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${base64}?=`;
}

function buildQuoteUrl(data: ContactSubmission): string {
  if (!data.jobId) return `${getSiteUrl()}/admin`;
  return `${getSiteUrl()}/admin/quotes/${escapeUrl(data.jobId)}`;
}

function buildJobUrl(data: ContactSubmission): string {
  if (!data.jobId) return `${getSiteUrl()}/admin`;
  return `${getSiteUrl()}/admin/jobs/${escapeUrl(data.jobId)}`;
}

function buildMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${escapeUrl(address)}`;
}

function buildEmailHtml(data: ContactSubmission): string {
  const row = (label: string, value: string) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-weight:600;width:160px;">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#1f2937;">${escapeHtml(value) || "&mdash;"}</td>
    </tr>
  `;

  const quoteUrl = buildQuoteUrl(data);
  const jobUrl = buildJobUrl(data);
  const mapsUrl = buildMapsUrl(data.address);
  const showQuoteButton = Boolean(data.jobId);
  const returningBadge =
    data.isReturningCustomer && (data.priorJobCount ?? 0) > 0
      ? `<span style="display:inline-block;margin-left:8px;padding:2px 8px;background:#FEF3C7;color:#92400E;font-size:11px;font-weight:700;border-radius:4px;text-transform:uppercase;letter-spacing:0.5px;">Returning · ${data.priorJobCount} prior</span>`
      : "";
  const duplicateBanner =
    (data.duplicateLast24hCount ?? 0) > 0
      ? `<div style="padding:12px 16px;background:#FEF3C7;border-left:4px solid #D97706;border-radius:4px;margin-bottom:16px;font-size:13px;color:#92400E;">
           <strong>Heads up:</strong> this customer also submitted ${data.duplicateLast24hCount} time(s) in the last 24 hours.
         </div>`
      : "";

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
                <div style="font-size:22px;font-weight:700;margin-top:6px;">New lead${returningBadge}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                ${duplicateBanner}
                ${
                  showQuoteButton
                    ? `<div style="text-align:center;margin:8px 0 24px;">
                         <a href="${quoteUrl}" style="display:inline-block;background:#D97706;color:#ffffff;padding:16px 36px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;min-height:44px;">
                           Build Quote &rarr;
                         </a>
                       </div>`
                    : ""
                }
                <div style="padding:14px;background:#FFF7ED;border-left:4px solid #D97706;border-radius:4px;margin-bottom:20px;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#9A3412;font-weight:600;">Call back at</div>
                  <a href="tel:${escapeHtml(data.phone)}" style="font-size:22px;font-weight:700;color:#1B3A5C;text-decoration:none;">${escapeHtml(data.phone)}</a>
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
                  ${row("Name", data.name)}
                  <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-weight:600;width:160px;">Phone</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#1f2937;">
                      <a href="tel:${escapeHtml(data.phone)}" style="color:#1B3A5C;text-decoration:underline;">${escapeHtml(data.phone)}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-weight:600;width:160px;">Email</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#1f2937;">
                      <a href="mailto:${escapeHtml(data.email)}" style="color:#1B3A5C;text-decoration:underline;">${escapeHtml(data.email)}</a>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#4b5563;font-weight:600;width:160px;">Address</td>
                    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#1f2937;">
                      <a href="${mapsUrl}" target="_blank" style="color:#1B3A5C;text-decoration:underline;">${escapeHtml(data.address)}</a>
                    </td>
                  </tr>
                  ${data.propertyType ? row("Property type", data.propertyType) : ""}
                  ${row("Service", data.serviceType)}
                  ${row("Preferred date", data.preferredDate)}
                  ${data.urgency ? row("Urgency", data.urgency) : ""}
                  ${data.bestContactTime ? row("Best contact time", data.bestContactTime) : ""}
                  ${data.bestContactMethod ? row("Best contact method", data.bestContactMethod) : ""}
                  ${row("Referral source", data.referralSource)}
                  ${row("Submitted", data.submittedAt)}
                </table>
                <div style="margin-top:20px;">
                  <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;margin-bottom:8px;">Description of work</div>
                  <div style="padding:14px;background:#F3F4F6;border-radius:6px;white-space:pre-wrap;">${escapeHtml(data.description)}</div>
                </div>
                ${
                  data.photoUrls && data.photoUrls.length > 0
                    ? `<div style="margin-top:20px;">
                         <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:600;margin-bottom:8px;">Photos (${data.photoUrls.length})</div>
                         <ul style="margin:0;padding:0;list-style:none;">
                           ${data.photoUrls
                             .map(
                               (url, idx) =>
                                 `<li style="margin:6px 0;"><a href="${escapeHtml(url)}" style="color:#1B3A5C;text-decoration:underline;">View photo ${idx + 1} in Drive</a></li>`,
                             )
                             .join("")}
                         </ul>
                       </div>`
                    : ""
                }
                ${
                  showQuoteButton
                    ? `<div style="margin-top:24px;font-size:13px;color:#6b7280;">
                         <a href="${jobUrl}" style="color:#1B3A5C;text-decoration:underline;">View lead in admin</a>
                         &nbsp;·&nbsp;
                         <a href="mailto:${escapeHtml(data.email)}?subject=${escapeUrl("Re: Your Forge Handyman request")}" style="color:#1B3A5C;text-decoration:underline;">Reply to customer</a>
                       </div>`
                    : ""
                }
                <div style="margin-top:16px;font-size:11px;color:#9CA3AF;font-style:italic;">
                  First-touch SLA: respond within 4 hours.
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:#F3F4F6;padding:16px 28px;font-size:12px;color:#6b7280;text-align:center;">
                Forge Handyman Service · Garner, Clayton &amp; South Raleigh, NC
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
  const quoteUrl = buildQuoteUrl(data);
  const showLink = Boolean(data.jobId);
  const dupLine =
    (data.duplicateLast24hCount ?? 0) > 0
      ? [`HEADS UP: customer also submitted ${data.duplicateLast24hCount} time(s) in the last 24 hours.`, ""]
      : [];
  const returningLine = data.isReturningCustomer
    ? [`Returning customer · ${data.priorJobCount} prior job(s).`, ""]
    : [];

  return [
    "NEW FORGE LEAD",
    "",
    ...returningLine,
    ...dupLine,
    ...(showLink ? [`Build Quote: ${quoteUrl}`, ""] : []),
    `Name: ${data.name}`,
    `Phone: ${data.phone}`,
    `Email: ${data.email}`,
    `Address: ${data.address}`,
    data.propertyType ? `Property type: ${data.propertyType}` : "",
    `Service: ${data.serviceType}`,
    `Preferred date: ${data.preferredDate}`,
    data.urgency ? `Urgency: ${data.urgency}` : "",
    data.bestContactTime ? `Best contact time: ${data.bestContactTime}` : "",
    data.bestContactMethod ? `Best contact method: ${data.bestContactMethod}` : "",
    `Referral source: ${data.referralSource}`,
    `Submitted: ${data.submittedAt}`,
    "",
    "Description of work:",
    data.description,
    "",
    "— Forge",
  ]
    .filter((line) => line !== "")
    .join("\n");
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

export async function sendNotificationEmail(data: ContactSubmission): Promise<void> {
  const auth = getAuth();
  const gmail = google.gmail({ version: "v1", auth });
  const businessEmail = getBusinessEmail();

  const firstName = (data.name || "Customer").split(/\s+/)[0] || "Customer";
  const cityGuess = extractCityFromAddress(data.address);
  const cityFragment = cityGuess ? ` in ${cityGuess}` : "";
  const duplicateCount = data.duplicateLast24hCount ?? 0;
  const ordinalPrefix =
    duplicateCount === 1
      ? "[2nd] "
      : duplicateCount === 2
        ? "[3rd] "
        : duplicateCount >= 3
          ? `[${duplicateCount + 1}th] `
          : "";

  const raw = encodeRfc2822({
    to: businessEmail,
    from: businessEmail,
    replyTo: data.email || businessEmail,
    subject: `${ordinalPrefix}New lead: ${firstName} — ${data.serviceType}${cityFragment}`,
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
