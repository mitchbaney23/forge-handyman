import type Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'
import { logger, maskEmail } from '@/lib/security/logger'
import { appendAuditRow } from '@/lib/sheet/audit-log'
import { updateRowByJobId } from '@/lib/sheet/repo'
import { getStripe } from '@/lib/stripe/client'

function extractJobId(metadata: Stripe.Metadata | null | undefined): string | null {
  if (!metadata) return null
  const value = metadata.jobId
  return typeof value === 'string' && value.length > 0 ? value : null
}

export async function handleCheckoutSessionCompleted(
  event: Stripe.Event,
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session
  const jobId = extractJobId(session.metadata)
  if (!jobId) {
    logger.warn({ eventId: event.id, sessionId: session.id }, 'stripe: checkout.session.completed missing jobId')
    return
  }

  const stripe = getStripe()
  let paymentMethodId: string | null = null
  let customerId: string | null =
    typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null

  if (session.payment_intent) {
    const piId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent.id
    const pi = await stripe.paymentIntents.retrieve(piId)
    paymentMethodId =
      typeof pi.payment_method === 'string'
        ? pi.payment_method
        : pi.payment_method?.id ?? null
    if (!customerId) {
      customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id ?? null
    }
  }

  const updated = await updateRowByJobId(jobId, {
    status: 'Booked',
    deposit_paid_cents: String(session.amount_total ?? 0),
    stripe_customer_id: customerId ?? '',
    stripe_payment_method_id: paymentMethodId ?? '',
  })

  logger.info(
    {
      eventId: event.id,
      jobId,
      sessionId: session.id,
      maskedEmail: maskEmail(session.customer_details?.email),
      amountCents: session.amount_total,
      rowUpdated: updated.updated,
    },
    'stripe: checkout.session.completed processed',
  )

  await appendAuditRow({
    actor: 'stripe-webhook',
    action: 'job.booked',
    target: jobId,
    after: JSON.stringify({
      sessionId: session.id,
      amountPaidCents: session.amount_total,
      stripeCustomerId: customerId,
    }),
  })
}

export async function handlePaymentIntentSucceeded(
  event: Stripe.Event,
): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent
  const jobId = extractJobId(pi.metadata)
  if (!jobId) {
    logger.info({ eventId: event.id, paymentIntentId: pi.id }, 'stripe: payment_intent.succeeded (no jobId — likely deposit checkout)')
    return
  }

  const purpose = typeof pi.metadata?.purpose === 'string' ? pi.metadata.purpose : 'unknown'

  logger.info(
    {
      eventId: event.id,
      jobId,
      paymentIntentId: pi.id,
      amountCents: pi.amount,
      purpose,
    },
    'stripe: payment_intent.succeeded processed',
  )

  await appendAuditRow({
    actor: 'stripe-webhook',
    action: `payment.${purpose}.succeeded`,
    target: jobId,
    after: JSON.stringify({
      paymentIntentId: pi.id,
      amountCents: pi.amount,
    }),
  })

  if (purpose === 'balance-charge') {
    await updateRowByJobId(jobId, {
      status: 'Complete',
      balance_owed_cents: '0',
    })
  }
}

export async function handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
  const pi = event.data.object as Stripe.PaymentIntent
  const jobId = extractJobId(pi.metadata)
  const failureCode = pi.last_payment_error?.code ?? null
  const failureMessage = pi.last_payment_error?.message ?? 'unknown'

  Sentry.captureMessage('Stripe payment_intent.payment_failed', {
    level: 'warning',
    tags: {
      route: 'stripe-webhook',
      jobId: jobId ?? 'unknown',
      failureCode: failureCode ?? 'unknown',
    },
    extra: {
      paymentIntentId: pi.id,
      amountCents: pi.amount,
      failureMessage,
    },
  })

  logger.warn(
    {
      eventId: event.id,
      jobId,
      paymentIntentId: pi.id,
      failureCode,
      amountCents: pi.amount,
    },
    'stripe: payment_intent.payment_failed processed',
  )

  if (jobId) {
    await updateRowByJobId(jobId, { status: 'Payment Failed' })
    await appendAuditRow({
      actor: 'stripe-webhook',
      action: 'payment.failed',
      target: jobId,
      after: JSON.stringify({
        paymentIntentId: pi.id,
        failureCode,
        failureMessage,
      }),
    })
  }
}

export async function handleCustomerCreated(event: Stripe.Event): Promise<void> {
  const customer = event.data.object as Stripe.Customer
  logger.info(
    {
      eventId: event.id,
      stripeCustomerId: customer.id,
      maskedEmail: maskEmail(customer.email ?? undefined),
    },
    'stripe: customer.created',
  )
  await appendAuditRow({
    actor: 'stripe-webhook',
    action: 'customer.created',
    target: customer.id,
    after: JSON.stringify({ stripeCustomerId: customer.id }),
  })
}

export async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge
  const jobId = extractJobId(charge.metadata)

  logger.info(
    {
      eventId: event.id,
      jobId,
      chargeId: charge.id,
      amountRefundedCents: charge.amount_refunded,
      fullyRefunded: charge.refunded,
    },
    'stripe: charge.refunded processed',
  )

  if (jobId) {
    await updateRowByJobId(jobId, {
      status: charge.refunded ? 'Refunded' : 'Partial Refund',
    })
    await appendAuditRow({
      actor: 'stripe-webhook',
      action: charge.refunded ? 'charge.fully_refunded' : 'charge.partially_refunded',
      target: jobId,
      after: JSON.stringify({
        chargeId: charge.id,
        amountRefundedCents: charge.amount_refunded,
      }),
    })
  }
}
