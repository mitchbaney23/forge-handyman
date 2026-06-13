import { buildIdempotencyKey, getStripe } from '@/lib/stripe/client'
import { appendAuditRow } from '@/lib/data'
import { logger, maskEmail } from '@/lib/security/logger'

export interface QuoteLineItem {
  name: string
  description?: string
  amountCents: number
  quantity?: number
}

export interface QuoteInput {
  jobId: string
  customerEmail: string
  customerName: string
  depositCents: number
  balanceCents: number
  tier: 'small' | 'medium' | 'large'
  description: string
}

export interface CreatedPaymentLink {
  url: string
  paymentLinkId: string
  expiresAt: string
}

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60

export async function createQuotePaymentLink(
  quote: QuoteInput,
  actor: string,
): Promise<CreatedPaymentLink> {
  const stripe = getStripe()
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_SECONDS * 1000).toISOString()

  const product = await stripe.products.create(
    {
      name: `Forge Handyman — ${quote.description}`,
      description: `Deposit for ${quote.tier} job (balance: $${(quote.balanceCents / 100).toFixed(2)})`,
      metadata: { jobId: quote.jobId, tier: quote.tier },
    },
    { idempotencyKey: buildIdempotencyKey('quote-product', quote.jobId) },
  )

  const price = await stripe.prices.create(
    {
      product: product.id,
      unit_amount: quote.depositCents,
      currency: 'usd',
      metadata: { jobId: quote.jobId },
    },
    { idempotencyKey: buildIdempotencyKey('quote-price', quote.jobId) },
  )

  const paymentLink = await stripe.paymentLinks.create(
    {
      line_items: [{ price: price.id, quantity: 1 }],
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: {
          jobId: quote.jobId,
          customerEmail: quote.customerEmail,
          tier: quote.tier,
          balanceCents: String(quote.balanceCents),
        },
      },
      metadata: {
        jobId: quote.jobId,
        customerEmail: quote.customerEmail,
        tier: quote.tier,
        balanceCents: String(quote.balanceCents),
      },
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: {
          custom_message:
            "Thanks — David will reach out to confirm the appointment within one business day.",
        },
      },
      restrictions: {
        completed_sessions: { limit: 1 },
      },
    },
    { idempotencyKey: buildIdempotencyKey('quote-link', quote.jobId) },
  )

  logger.info(
    {
      jobId: quote.jobId,
      paymentLinkId: paymentLink.id,
      tier: quote.tier,
      customerEmail: maskEmail(quote.customerEmail),
      depositCents: quote.depositCents,
    },
    'stripe: payment link created',
  )

  await appendAuditRow({
    actor,
    action: 'payment_link.created',
    target: quote.jobId,
    after: JSON.stringify({
      paymentLinkId: paymentLink.id,
      depositCents: quote.depositCents,
      tier: quote.tier,
    }),
  })

  return {
    url: paymentLink.url,
    paymentLinkId: paymentLink.id,
    expiresAt,
  }
}
