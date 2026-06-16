import type Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'
import { logger, maskEmail } from '@/lib/security/logger'
import { appendAuditRow, updateRowByJobId } from '@/lib/data'
import { getBackend } from '@/lib/data/backend'
import { recordPayment, reconcileAttempt } from '@/lib/data/pg/payments'
import { getStripe } from '@/lib/stripe/client'

function extractJobId(metadata: Stripe.Metadata | null | undefined): string | null {
  if (!metadata) return null
  const value = metadata.jobId
  return typeof value === 'string' && value.length > 0 ? value : null
}

// The payments ledger is postgres-only and strictly best-effort: a failure
// here must NEVER fail the webhook (the status flip + audit are the primary
// work). Gated on the active backend so sheet-mode webhooks no-op cleanly.
async function recordPaymentSafe(fn: () => Promise<void>): Promise<void> {
  if (getBackend() !== 'postgres') return
  try {
    await fn()
  } catch (err) {
    logger.warn({ err }, 'stripe: payments-ledger write failed (non-fatal)')
    Sentry.captureException(err, {
      tags: { route: 'stripe-webhook', step: 'payments-ledger' },
    })
  }
}

function chargeIdOf(pi: Stripe.PaymentIntent): string {
  const c = pi.latest_charge
  return typeof c === 'string' ? c : (c?.id ?? '')
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
  let depositPaymentIntentId = ''

  if (session.payment_intent) {
    const piId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent.id
    depositPaymentIntentId = piId
    const pi = await stripe.paymentIntents.retrieve(piId)
    paymentMethodId =
      typeof pi.payment_method === 'string'
        ? pi.payment_method
        : pi.payment_method?.id ?? null
    if (!customerId) {
      customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id ?? null
    }
  }

  // Fallback: when setup_future_usage attaches a card, the customer ID
  // sometimes isn't yet present on session.customer OR pi.customer at the
  // time the webhook fires. The PaymentMethod object reliably has it
  // because the PM is attached to the customer for off-session reuse.
  if (paymentMethodId && !customerId) {
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId)
      customerId =
        typeof pm.customer === 'string' ? pm.customer : pm.customer?.id ?? null
    } catch (err) {
      logger.warn(
        { err, paymentMethodId, sessionId: session.id },
        'stripe: failed to retrieve payment method for customer fallback',
      )
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
    jobId,
    after: JSON.stringify({
      sessionId: session.id,
      amountPaidCents: session.amount_total,
      stripeCustomerId: customerId,
    }),
  })

  // Ledger: record the deposit (no guard — a hosted single-use checkout link
  // isn't re-chargeable from our side).
  await recordPaymentSafe(() =>
    recordPayment({
      jobId,
      purpose: 'deposit',
      status: 'succeeded',
      amountCents: session.amount_total ?? null,
      stripePaymentIntentId: depositPaymentIntentId,
      stripeCustomerId: customerId ?? '',
    }),
  )
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
    jobId,
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
    // Reconcile the markComplete guard row to its terminal state (idempotent —
    // a no-op if markComplete's sync update already marked it succeeded).
    await recordPaymentSafe(() =>
      reconcileAttempt(jobId, 'balance-charge', {
        status: 'succeeded',
        stripePaymentIntentId: pi.id,
        stripeChargeId: chargeIdOf(pi),
      }),
    )
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
      jobId,
      after: JSON.stringify({
        paymentIntentId: pi.id,
        failureCode,
        failureMessage,
      }),
    })
    // A failed balance charge frees its guard row so a deliberate retry is
    // possible (the 'failed' status drops out of the partial unique index).
    const purpose = typeof pi.metadata?.purpose === 'string' ? pi.metadata.purpose : ''
    if (purpose === 'balance-charge') {
      await recordPaymentSafe(() =>
        reconcileAttempt(jobId, 'balance-charge', {
          status: 'failed',
          stripePaymentIntentId: pi.id,
          error: failureMessage,
        }),
      )
    }
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
      jobId,
      after: JSON.stringify({
        chargeId: charge.id,
        amountRefundedCents: charge.amount_refunded,
      }),
    })
    // Ledger: record the refund (positive amount under purpose 'refund'; LTV
    // computation subtracts these from collected revenue).
    await recordPaymentSafe(() =>
      recordPayment({
        jobId,
        purpose: 'refund',
        status: 'succeeded',
        amountCents: charge.amount_refunded ?? 0,
        stripeChargeId: charge.id,
        stripePaymentIntentId:
          typeof charge.payment_intent === 'string' ? charge.payment_intent : '',
      }),
    )
  }
}
