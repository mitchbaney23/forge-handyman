import { google } from 'googleapis'
import type { JWT } from 'google-auth-library'
import { BUSINESS } from '@/lib/constants'

// "Work's done — here's your receipt" email, sent best-effort from
// markComplete. Doubles as the review ask (the caller stamps review_sent_at on
// success so the send-review-requests cron stays a backstop for jobs where
// this email failed, instead of double-asking).

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

function encodeMimeHeader(value: string): string {
  if (!value) return value
  if (Array.from(value).every((ch) => ch.charCodeAt(0) <= 0x7f)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

// Mirrors lib/email/review-request.ts: explicit Place URL when configured,
// else a search that surfaces the GBP card.
function getReviewUrl(): string {
  if (process.env.GOOGLE_REVIEW_URL) return process.env.GOOGLE_REVIEW_URL
  return 'https://www.google.com/search?q=Forge+Handyman+Service+Garner+NC'
}

export interface CompletionReceiptEmailInput {
  toEmail: string
  toName: string
  serviceType: string
  depositPaidCents: number
  balanceChargedCents: number
  // Balance we could NOT charge (no saved card) — shown as still due.
  balanceOwedCents: number
}

function firstNameOf(name: string): string {
  return (name || 'there').split(/\s+/)[0] || 'there'
}

function totalPaidCents(data: CompletionReceiptEmailInput): number {
  return data.depositPaidCents + data.balanceChargedCents
}

function buildHtml(data: CompletionReceiptEmailInput): string {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
  const rows: string[] = []
  if (data.depositPaidCents > 0) {
    rows.push(`<tr>
      <td style="padding:6px 0;font-size:14px;color:#374151;">Deposit paid</td>
      <td style="padding:6px 0;font-size:14px;color:#374151;text-align:right;">${dollars(data.depositPaidCents)}</td>
    </tr>`)
  }
  if (data.balanceChargedCents > 0) {
    rows.push(`<tr>
      <td style="padding:6px 0;font-size:14px;color:#374151;">Balance charged to your card</td>
      <td style="padding:6px 0;font-size:14px;color:#374151;text-align:right;">${dollars(data.balanceChargedCents)}</td>
    </tr>`)
  }
  rows.push(`<tr>
    <td style="padding:10px 0 6px;font-size:14px;font-weight:700;color:#1f2937;border-top:1px solid #e5e7eb;">Total paid</td>
    <td style="padding:10px 0 6px;font-size:14px;font-weight:700;color:#1f2937;text-align:right;border-top:1px solid #e5e7eb;">${dollars(totalPaidCents(data))}</td>
  </tr>`)
  const owedBlock =
    data.balanceOwedCents > 0
      ? `<p style="margin:0 0 16px;font-size:14px;color:#92400e;background:#FEF3C7;border-radius:8px;padding:10px 14px;line-height:1.5;">
          Remaining balance: <strong>${dollars(data.balanceOwedCents)}</strong> — we'll follow up on collecting it.
        </p>`
      : ''
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
            <td style="padding:28px;">
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(firstNameOf(data.toName))},</p>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
                The work on your <strong>${escapeHtml(data.serviceType)}</strong> job is done —
                thanks for having us out. Here's your receipt:
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
                ${rows.join('\n')}
              </table>
              ${owedBlock}
              <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">
                If you were happy with the work, a quick Google review makes a real
                difference for a small local business:
              </p>
              <div style="margin:0 0 16px;">
                <a href="${getReviewUrl()}" style="display:inline-block;background:#D97706;color:#ffffff;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">
                  Leave a Google review &rarr;
                </a>
              </div>
              <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.55;">
                If anything wasn&rsquo;t up to standard, please reply to this email instead.
                We&rsquo;ll make it right.
              </p>
              <p style="margin:24px 0 0;font-size:14px;color:#374151;">&mdash; The Forge team</p>
            </td>
          </tr>
          <tr>
            <td style="background:#F3F4F6;padding:16px 28px;font-size:11px;color:#6b7280;text-align:center;line-height:1.5;">
              Forge Handyman Service · Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs &amp; Fuquay-Varina, NC<br/>
              ${escapeHtml(BUSINESS.mailingAddress)}
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function buildText(data: CompletionReceiptEmailInput): string {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
  return [
    `Hi ${firstNameOf(data.toName)},`,
    '',
    `The work on your ${data.serviceType} job is done — thanks for having us out. Here's your receipt:`,
    '',
    ...(data.depositPaidCents > 0 ? [`Deposit paid: ${dollars(data.depositPaidCents)}`] : []),
    ...(data.balanceChargedCents > 0
      ? [`Balance charged to your card: ${dollars(data.balanceChargedCents)}`]
      : []),
    `Total paid: ${dollars(totalPaidCents(data))}`,
    ...(data.balanceOwedCents > 0
      ? ['', `Remaining balance: ${dollars(data.balanceOwedCents)} — we'll follow up on collecting it.`]
      : []),
    '',
    'If you were happy with the work, a quick Google review makes a real difference for a small local business:',
    getReviewUrl(),
    '',
    "If anything wasn't up to standard, please reply to this email instead. We'll make it right.",
    '',
    '— The Forge team',
    '',
    'Forge Handyman Service · Serving Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs & Fuquay-Varina, NC',
    BUSINESS.mailingAddress,
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

export async function sendCompletionReceiptEmail(
  data: CompletionReceiptEmailInput,
): Promise<void> {
  const auth = getAuth()
  const gmail = google.gmail({ version: 'v1', auth })
  const businessEmail = getBusinessEmail()

  const raw = encodeRfc2822({
    to: data.toEmail,
    from: businessEmail,
    replyTo: businessEmail,
    subject: `Your receipt from Forge Handyman — ${data.serviceType}`,
    html: buildHtml(data),
    text: buildText(data),
  })

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}
