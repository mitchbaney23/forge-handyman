import { appendAuditRow, findRowByJobId, updateRowByJobId } from '@/lib/data'
import { ACTIONS } from '@/lib/data/activity-actions'
import { sendQuoteEmail } from '@/lib/email/quote'
import { logger, maskEmail } from '@/lib/security/logger'
import { createQuotePaymentLink } from '@/lib/stripe/payment-links'

// ---------------------------------------------------------------------------
// The quote CORE — framework-free, actor-parameterized, like lib/crm/mutations.
//
// "Build a quote" in this business means: create a Stripe Payment Link for the
// deposit (card saved for the balance), email it to the customer, flip the job
// to Quoted and stamp the quote.sent activity the lifecycle cron reads back.
// Both callers run exactly this code:
//   - the admin quote page (app/admin/quotes/[id]/actions.ts), actor
//     `admin:<email>`, which wraps it with the session check, the admin-money
//     rate limit and revalidatePath;
//   - the MCP send_quote tool (lib/mcp/tools.ts), actor `claude:<label>`, which
//     wraps it with the bearer token, both rate limits and a status guard.
// Therefore this module must NOT import next/* or touch the session.
// ---------------------------------------------------------------------------

export const QUOTE_TIERS = ['small', 'medium', 'large'] as const
export type QuoteTier = (typeof QUOTE_TIERS)[number]

// What the quote email shows the customer; also the Stripe product name.
export const QUOTE_DESCRIPTION_MAX = 500
// Stripe will not sell a $0 line item, and a deposit is what saves the card.
export const MIN_DEPOSIT_CENTS = 100

export interface SendQuoteArgs {
  jobId: string
  depositCents: number
  balanceCents: number
  tier: QuoteTier
  // Overrides the job's own description in the email. Empty or whitespace
  // falls back to the job description, then the service type.
  description?: string
  actor: string
}

export type SendQuoteStep = 'validate' | 'payment_link' | 'email'

export type SendQuoteResult =
  | {
      ok: true
      paymentLinkUrl: string
      paymentLinkId: string
      expiresAt: string
      depositCents: number
      balanceCents: number
      sentTo: string
    }
  | { ok: false; error: string; step: SendQuoteStep; cause?: unknown }

function refuse(error: string): SendQuoteResult {
  return { ok: false, error, step: 'validate' }
}

export async function sendQuote(args: SendQuoteArgs): Promise<SendQuoteResult> {
  const { jobId, depositCents, balanceCents, tier, actor } = args

  if (!QUOTE_TIERS.includes(tier)) return refuse('Invalid tier')
  if (!Number.isInteger(depositCents) || depositCents < 0) {
    return refuse('Deposit must be a non-negative whole number of cents')
  }
  if (!Number.isInteger(balanceCents) || balanceCents < 0) {
    return refuse('Balance must be a non-negative whole number of cents')
  }
  if (depositCents < MIN_DEPOSIT_CENTS) return refuse('Deposit must be at least $1.00')

  const found = await findRowByJobId(jobId)
  if (!found) return refuse('Job not found')

  const customerEmail = found.row.email
  const customerName = found.row.name
  const serviceType = found.row.service_type
  if (!customerEmail || !customerName) {
    return refuse('Customer email or name missing on job row')
  }

  const description = ((args.description ?? '').trim() || found.row.description || serviceType).slice(
    0,
    QUOTE_DESCRIPTION_MAX,
  )

  let paymentLink
  try {
    paymentLink = await createQuotePaymentLink(
      { jobId, customerEmail, customerName, depositCents, balanceCents, tier, description },
      actor,
    )
  } catch (err) {
    logger.error({ err, jobId, actor }, 'quote: createQuotePaymentLink failed')
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't create Payment Link",
      step: 'payment_link',
      cause: err,
    }
  }

  try {
    await sendQuoteEmail({
      toEmail: customerEmail,
      toName: customerName,
      serviceType,
      description,
      depositCents,
      balanceCents,
      paymentLinkUrl: paymentLink.url,
      expiresAt: paymentLink.expiresAt,
    })
  } catch (err) {
    logger.error({ err, jobId, actor }, 'quote: sendQuoteEmail failed')
    return {
      ok: false,
      error:
        'Payment Link was created but the email failed to send. Copy the link from Stripe Dashboard and send manually.',
      step: 'email',
      cause: err,
    }
  }

  await updateRowByJobId(jobId, {
    status: 'Quoted',
    balance_owed_cents: String(balanceCents),
  })
  await appendAuditRow({
    actor,
    action: ACTIONS.QUOTE_SENT,
    target: jobId,
    jobId,
    after: JSON.stringify({
      paymentLinkId: paymentLink.paymentLinkId,
      // The lifecycle cron's quote-nudge check and the owner digest read these
      // back from the activity payload (there are no quote columns on the row).
      paymentLinkUrl: paymentLink.url,
      expiresAt: paymentLink.expiresAt,
      depositCents,
      balanceCents,
      tier,
      customerEmail: maskEmail(customerEmail),
    }),
  })
  logger.info(
    {
      jobId,
      actor,
      paymentLinkId: paymentLink.paymentLinkId,
      depositCents,
      balanceCents,
      tier,
      maskedEmail: maskEmail(customerEmail),
    },
    'quote: sent',
  )

  return {
    ok: true,
    paymentLinkUrl: paymentLink.url,
    paymentLinkId: paymentLink.paymentLinkId,
    expiresAt: paymentLink.expiresAt,
    depositCents,
    balanceCents,
    sentTo: customerEmail,
  }
}
