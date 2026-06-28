import { google } from 'googleapis'
import type { JWT } from 'google-auth-library'

const SCOPES = ['https://www.googleapis.com/auth/gmail.send']

function getBusinessEmail(): string {
  const email = process.env.BUSINESS_EMAIL
  if (!email) throw new Error('BUSINESS_EMAIL is not configured')
  return email
}

function getAuth(): JWT {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set')
  }
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
    subject: getBusinessEmail(),
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// RFC 2047 encoded-word for non-ASCII subject headers so em-dashes / accented
// names don't mojibake in email clients (the "Ã¢Â€Â" garble). Pure-ASCII passes
// through unchanged. Mirrors lib/google.ts's encoder.
function encodeMimeHeader(value: string): string {
  if (!value) return value
  if (Array.from(value).every((ch) => ch.charCodeAt(0) <= 0x7f)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

export interface QuoteEmailInput {
  toEmail: string
  toName: string
  serviceType: string
  description: string
  depositCents: number
  balanceCents: number
  paymentLinkUrl: string
  expiresAt: string
}

function buildQuoteHtml(data: QuoteEmailInput): string {
  const depositDollars = (data.depositCents / 100).toFixed(2)
  const balanceDollars = (data.balanceCents / 100).toFixed(2)
  const totalDollars = ((data.depositCents + data.balanceCents) / 100).toFixed(2)
  const expiresDate = new Date(data.expiresAt).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

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
                <div style="font-size:22px;font-weight:700;margin-top:6px;">Your quote is ready</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                  Hi ${escapeHtml(data.toName)},
                </p>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
                  Thanks for reaching out about your <strong>${escapeHtml(data.serviceType)}</strong> project. Here&rsquo;s the estimate:
                </p>
                <div style="padding:16px;background:#F9FAFB;border-radius:8px;margin:16px 0;">
                  <div style="font-size:14px;color:#4b5563;white-space:pre-wrap;">${escapeHtml(data.description)}</div>
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;font-size:15px;">
                  <tr>
                    <td style="padding:8px 0;color:#4b5563;">Deposit (due today)</td>
                    <td style="padding:8px 0;text-align:right;font-weight:600;color:#1B3A5C;">$${depositDollars}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#4b5563;">Balance (due on completion)</td>
                    <td style="padding:8px 0;text-align:right;font-weight:600;color:#1B3A5C;">$${balanceDollars}</td>
                  </tr>
                  <tr>
                    <td style="padding:12px 0 8px;border-top:2px solid #1B3A5C;color:#1B3A5C;font-weight:700;">Total estimate</td>
                    <td style="padding:12px 0 8px;border-top:2px solid #1B3A5C;text-align:right;color:#1B3A5C;font-weight:700;font-size:18px;">$${totalDollars}</td>
                  </tr>
                </table>
                <div style="text-align:center;margin:28px 0 8px;">
                  <a href="${data.paymentLinkUrl}" style="display:inline-block;background:#D97706;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;">
                    Pay deposit &amp; book the date
                  </a>
                </div>
                <p style="margin:16px 0 0;font-size:13px;color:#6b7280;text-align:center;">
                  This link expires on ${escapeHtml(expiresDate)}.
                </p>
                <p style="margin:24px 0 0;font-size:14px;line-height:1.5;color:#374151;">
                  Once your deposit is in, we&rsquo;ll lock in the date and send a confirmation. The balance auto-charges to the same card on the day David finishes the work.
                </p>
                <p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#374151;">
                  Questions? Just reply to this email.
                </p>
                <p style="margin:24px 0 0;font-size:14px;color:#374151;">
                  &mdash; The Forge team
                </p>
              </td>
            </tr>
            <tr>
              <td style="background:#F3F4F6;padding:16px 28px;font-size:12px;color:#6b7280;text-align:center;">
                Forge Handyman Service · Serving Garner, Clayton &amp; South Raleigh, NC
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function buildQuoteText(data: QuoteEmailInput): string {
  const depositDollars = (data.depositCents / 100).toFixed(2)
  const balanceDollars = (data.balanceCents / 100).toFixed(2)
  const totalDollars = ((data.depositCents + data.balanceCents) / 100).toFixed(2)
  return [
    `Hi ${data.toName},`,
    '',
    `Thanks for reaching out about your ${data.serviceType} project. Here's the estimate:`,
    '',
    data.description,
    '',
    `Deposit (due today):    $${depositDollars}`,
    `Balance (on completion): $${balanceDollars}`,
    `Total estimate:          $${totalDollars}`,
    '',
    `Pay deposit & book the date: ${data.paymentLinkUrl}`,
    '',
    `(Link expires on ${new Date(data.expiresAt).toLocaleDateString()}.)`,
    '',
    "Once your deposit is in, we'll lock in the date and send a confirmation. The balance auto-charges to the same card on the day David finishes the work.",
    '',
    'Questions? Just reply to this email.',
    '',
    '— The Forge team',
    '',
    'Forge Handyman Service · Serving Garner, Clayton & South Raleigh, NC',
  ].join('\n')
}

function encodeRfc2822(message: {
  to: string
  from: string
  replyTo: string
  subject: string
  html: string
  text: string
}): string {
  const boundary = `----=_Boundary_${Date.now()}`
  const lines = [
    `To: ${message.to}`,
    `From: ${message.from}`,
    `Reply-To: ${message.replyTo}`,
    `Subject: ${encodeMimeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    message.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    message.html,
    '',
    `--${boundary}--`,
  ].join('\r\n')

  return Buffer.from(lines)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function sendQuoteEmail(data: QuoteEmailInput): Promise<void> {
  const auth = getAuth()
  const gmail = google.gmail({ version: 'v1', auth })
  const businessEmail = getBusinessEmail()

  const raw = encodeRfc2822({
    to: data.toEmail,
    from: businessEmail,
    replyTo: businessEmail,
    subject: `Your quote from Forge Handyman — ${data.serviceType}`,
    html: buildQuoteHtml(data),
    text: buildQuoteText(data),
  })

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  })
}
