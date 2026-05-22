import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type Stripe from 'stripe'
import { logger } from '@/lib/security/logger'
import { checkAndMarkProcessed } from '@/lib/webhooks/idempotency'
import { getStripe, getWebhookSecret } from '@/lib/stripe/client'
import {
  handleChargeRefunded,
  handleCheckoutSessionCompleted,
  handleCustomerCreated,
  handlePaymentIntentFailed,
  handlePaymentIntentSucceeded,
} from '@/lib/stripe/webhook-handlers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutSessionCompleted(event)
      break
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(event)
      break
    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event)
      break
    case 'customer.created':
      await handleCustomerCreated(event)
      break
    case 'charge.refunded':
      await handleChargeRefunded(event)
      break
    default:
      logger.debug({ eventType: event.type, eventId: event.id }, 'stripe: unhandled event type')
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    logger.warn('stripe: missing stripe-signature header')
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let rawBody: string
  try {
    rawBody = await request.text()
  } catch (err) {
    logger.error({ err }, 'stripe: failed to read raw body')
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const stripe = getStripe()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, getWebhookSecret())
  } catch (err) {
    Sentry.captureMessage('Stripe webhook signature verification failed', {
      level: 'warning',
      tags: { route: 'stripe-webhook' },
    })
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'stripe: signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const { isFirst } = await checkAndMarkProcessed('stripe', event.id)
  if (!isFirst) {
    logger.info({ eventId: event.id, eventType: event.type }, 'stripe: duplicate event ignored (idempotency)')
    return NextResponse.json({ received: true, deduped: true })
  }

  try {
    await dispatch(event)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'stripe-webhook', eventType: event.type },
      extra: { eventId: event.id },
    })
    logger.error({ err, eventId: event.id, eventType: event.type }, 'stripe: handler threw')
    return NextResponse.json({ received: true, handled: false }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
