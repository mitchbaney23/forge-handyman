import type Stripe from 'stripe'
import * as Sentry from '@sentry/nextjs'
import { logger, maskEmail } from '@/lib/security/logger'
import {
  appendAuditRow,
  findRowByJobId,
  getAppointmentByJobId,
  updateRowByJobId,
} from '@/lib/data'
import { getBackend } from '@/lib/data/backend'
import { sendDepositReceiptEmail } from '@/lib/email/deposit-receipt'
import { sendCompletionReceiptEmail } from '@/lib/email/completion-receipt'
import { formatEtDay, formatEtTime } from '@/lib/scheduling/time'
import { recordPayment, recordRefund, reconcileAttempt } from '@/lib/data/pg/payments'
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

  // A paid balance link resolves an outstanding balance on an existing job —
  // routing it through the deposit path below would re-Book the job and
  // overwrite deposit_paid_cents with the balance amount.
  if (session.metadata?.purpose === 'balance-link') {
    await handleBalanceLinkPaid({
      event,
      session,
      jobId,
      customerId,
      paymentMethodId,
      paymentIntentId: depositPaymentIntentId,
    })
    return
  }

  // No Customer means Stripe ran a guest checkout and the card was NOT saved —
  // Mark Complete will have nothing to charge for the balance. customer_creation
  // 'always' on the link should make this impossible; alarm if it recurs.
  if (!customerId) {
    Sentry.captureMessage('Stripe deposit completed without a Customer — card not saved for balance charge', {
      level: 'warning',
      tags: { route: 'stripe-webhook', jobId },
      extra: { sessionId: session.id, paymentMethodId },
    })
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

  // Deposit receipt to the customer — best-effort: a failed email must never
  // 500 the webhook (the retry would re-run the whole handler for a send-only
  // failure).
  try {
    const found = await findRowByJobId(jobId)
    const toEmail = found?.row.email || session.customer_details?.email || ''
    if (toEmail) {
      let appointmentLabel: string | undefined
      if (getBackend() === 'postgres') {
        const appt = await getAppointmentByJobId(jobId)
        if (appt) {
          const starts = new Date(appt.startsAt)
          appointmentLabel = `${formatEtDay(starts)} · ${formatEtTime(starts)}`
        }
      }
      await sendDepositReceiptEmail({
        toEmail,
        toName: found?.row.name || session.customer_details?.name || '',
        serviceType: found?.row.service_type || 'service',
        amountPaidCents: session.amount_total ?? 0,
        balanceCents: Number(found?.row.balance_owed_cents || '0'),
        appointmentLabel,
      })
      logger.info(
        { jobId, maskedEmail: maskEmail(toEmail) },
        'stripe: deposit receipt sent',
      )
    }
  } catch (err) {
    logger.warn({ err, jobId }, 'stripe: deposit receipt email failed (non-fatal)')
    Sentry.captureException(err, {
      tags: { route: 'stripe-webhook', step: 'deposit-receipt' },
    })
  }
}

// A customer paid an outstanding-balance payment link. Zeros the balance,
// stores the (now real, thanks to customer_creation: 'always') saved card for
// future jobs, and sends the paid-in-full receipt. Never touches status/Booked
// or deposit_paid_cents — the job was already deposited and usually Complete.
async function handleBalanceLinkPaid(args: {
  event: Stripe.Event
  session: Stripe.Checkout.Session
  jobId: string
  customerId: string | null
  paymentMethodId: string | null
  paymentIntentId: string
}): Promise<void> {
  const { event, session, jobId, customerId, paymentMethodId, paymentIntentId } = args
  const found = await findRowByJobId(jobId)
  if (!found) {
    logger.warn({ eventId: event.id, jobId }, 'stripe: balance-link paid for unknown job')
    return
  }

  const amountCents = session.amount_total ?? 0
  await updateRowByJobId(jobId, {
    balance_owed_cents: '0',
    status: 'Complete',
    ...(found.row.complete_date ? {} : { complete_date: new Date().toISOString() }),
    // Update the stored card only when this checkout produced a Customer, and
    // always as a PAIR: leaving a stale guest payment method next to a new
    // customer id would look like a saved card but fail to charge.
    ...(customerId
      ? {
          stripe_customer_id: customerId,
          stripe_payment_method_id: paymentMethodId ?? '',
        }
      : {}),
  })

  logger.info(
    {
      eventId: event.id,
      jobId,
      sessionId: session.id,
      amountCents,
      maskedEmail: maskEmail(session.customer_details?.email),
    },
    'stripe: balance link paid',
  )

  await appendAuditRow({
    actor: 'stripe-webhook',
    action: 'balance.paid_via_link',
    target: jobId,
    jobId,
    after: JSON.stringify({
      sessionId: session.id,
      amountCents,
      stripeCustomerId: customerId,
    }),
  })

  await recordPaymentSafe(() =>
    recordPayment({
      jobId,
      purpose: 'balance-link',
      status: 'succeeded',
      amountCents,
      stripePaymentIntentId: paymentIntentId,
      stripeCustomerId: customerId ?? '',
    }),
  )

  // Paid-in-full receipt — for a job whose completion receipt said "balance
  // still due", this is the corrected record. Best-effort, never 500s the
  // webhook.
  try {
    const toEmail = found.row.email || session.customer_details?.email || ''
    if (toEmail) {
      await sendCompletionReceiptEmail({
        toEmail,
        toName: found.row.name || session.customer_details?.name || '',
        serviceType: found.row.service_type || 'service',
        depositPaidCents: Number(found.row.deposit_paid_cents || '0'),
        balanceChargedCents: amountCents,
        balanceOwedCents: 0,
      })
      if (!(found.row.review_sent_at || '').trim()) {
        await updateRowByJobId(jobId, { review_sent_at: new Date().toISOString() })
      }
      logger.info({ jobId, maskedEmail: maskEmail(toEmail) }, 'stripe: balance-link receipt sent')
    }
  } catch (err) {
    logger.warn({ err, jobId }, 'stripe: balance-link receipt failed (non-fatal)')
    Sentry.captureException(err, {
      tags: { route: 'stripe-webhook', step: 'balance-link-receipt' },
    })
  }
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

    // Completion receipt for completions THIS webhook owns (3DS-deferred
    // charges, where markComplete returned requires_action and never sent
    // one). The review_sent_at stamp is the dedupe: markComplete's sync path
    // stamps it on send, so this only fires when no receipt went out — which
    // also makes it a retry for a markComplete whose email failed.
    // Best-effort: a send failure must never 500 the webhook.
    try {
      const found = await findRowByJobId(jobId)
      if (found && !(found.row.review_sent_at || '').trim() && found.row.email) {
        await sendCompletionReceiptEmail({
          toEmail: found.row.email,
          toName: found.row.name || '',
          serviceType: found.row.service_type || 'service',
          depositPaidCents: Number(found.row.deposit_paid_cents || '0'),
          balanceChargedCents: pi.amount,
          balanceOwedCents: 0,
        })
        await updateRowByJobId(jobId, {
          review_sent_at: new Date().toISOString(),
        })
        logger.info({ jobId }, 'stripe: completion receipt sent (webhook-owned completion)')
      }
    } catch (err) {
      logger.warn({ err, jobId }, 'stripe: completion receipt failed (review cron will still ask)')
      Sentry.captureException(err, {
        tags: { route: 'stripe-webhook', step: 'completion-receipt' },
      })
    }
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
  let jobId = extractJobId(charge.metadata)

  // Dashboard refunds and chargebacks carry no metadata on the Charge — our
  // jobId is stamped on the PaymentIntent (payment_intent_data on the deposit
  // link, metadata on the balance charge). Resolve through the parent PI
  // before giving up. A retrieve failure throws: the route releases the
  // idempotency claim and Stripe retries.
  if (!jobId) {
    const piId =
      typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id ?? null
    if (piId) {
      const pi = await getStripe().paymentIntents.retrieve(piId)
      jobId = extractJobId(pi.metadata)
    }
  }

  if (!jobId) {
    // Money left the account with no book entry — surface it, don't just log.
    Sentry.captureMessage('Stripe refund with unresolvable jobId', {
      level: 'warning',
      tags: { route: 'stripe-webhook', eventType: event.type },
      extra: {
        chargeId: charge.id,
        amountRefundedCents: charge.amount_refunded,
      },
    })
  }

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
    // Ledger: charge.amount_refunded is CUMULATIVE across partial refunds, so
    // the ledger keeps one row per refunded charge and replaces its amount —
    // an insert per event would double-count (and a late re-delivery after the
    // dedup TTL would duplicate).
    await recordPaymentSafe(() =>
      recordRefund({
        jobId,
        amountRefundedCents: charge.amount_refunded ?? 0,
        stripeChargeId: charge.id,
        stripePaymentIntentId:
          typeof charge.payment_intent === 'string'
            ? charge.payment_intent
            : charge.payment_intent?.id ?? '',
      }),
    )
  }
}
