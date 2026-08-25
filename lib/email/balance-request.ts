import { google } from 'googleapis'
import type { JWT } from 'google-auth-library'
import { BUSINESS } from '@/lib/constants'

// "Here's how to pay your remaining balance" email, sent from the admin
// sendBalanceLink action for jobs where Mark Complete had no saved card to
// charge. Carries a hosted Stripe payment link; the balance-link webhook
// zeros the job's balance and sends the paid-in-full receipt once paid.

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

export interface BalanceRequestEmailInput {
  toEmail: string
  toName: string
  serviceType: string
  amountCents: number
  payUrl: string
}

function firstNameOf(name: string): string {
  return (name || 'there').split(/\s+/)[0] || 'there'
}

function buildHtml(data: BalanceRequestEmailInput): string {
  const amount = `$${(data.amountCents / 100).toFixed(2)}`
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
                The remaining balance on your <strong>${escapeHtml(data.serviceType)}</strong> job is
                <strong>${amount}</strong>. You can pay it securely here:
              </p>
              <div style="margin:0 0 16px;">
                <a href="${data.payUrl}" style="display:inline-block;background:#D97706;color:#ffffff;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;text-decoration:none;">
                  Pay ${amount} &rarr;
                </a>
              </div>
              <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.55;">
                You'll get a receipt by email as soon as the payment goes through.
                If you've already settled this another way, or anything looks off,
                just reply to this email and we'll sort it out.
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

function buildText(data: BalanceRequestEmailInput): string {
  const amount = `$${(data.amountCents / 100).toFixed(2)}`
  return [
    `Hi ${firstNameOf(data.toName)},`,
    '',
    `The remaining balance on your ${data.serviceType} job is ${amount}. You can pay it securely here:`,
    '',
    data.payUrl,
    '',
    "You'll get a receipt by email as soon as the payment goes through. If you've already settled this another way, or anything looks off, just reply to this email and we'll sort it out.",
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

export async function sendBalanceRequestEmail(
  data: BalanceRequestEmailInput,
): Promise<void> {
  const auth = getAuth()
  const gmail = google.gmail({ version: 'v1', auth })
  const businessEmail = getBusinessEmail()

  const raw = encodeRfc2822({
    to: data.toEmail,
    from: businessEmail,
    replyTo: businessEmail,
    subject: `Balance due for your ${data.serviceType} job — Forge Handyman`,
    html: buildHtml(data),
    text: buildText(data),
  })

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}
