import Stripe from 'stripe'
import { buildIdempotencyKey, getStripe } from '@/lib/stripe/client'
import { appendAuditRow } from '@/lib/data'
import { logger, maskEmail } from '@/lib/security/logger'

export interface ChargeBalanceInput {
  jobId: string
  customerId: string
  paymentMethodId: string
  amountCents: number
  description: string
  customerEmail: string
}

export type ChargeBalanceResult =
  | {
      status: 'succeeded'
      paymentIntentId: string
      chargeId: string | null
    }
  | {
      status: 'requires_action'
      paymentIntentId: string
      clientSecret: string | null
      nextAction: 'authentication-required'
    }
  | {
      status: 'failed'
      paymentIntentId: string | null
      failureCode: string | null
      failureMessage: string
      recoverable: boolean
    }

interface StripeErrorLike {
  code?: string | null
  message: string
}

function classifyFailure(error: StripeErrorLike): {
  failureCode: string | null
  failureMessage: string
  recoverable: boolean
} {
  const code = error.code ?? null
  const message = error.message ?? 'Unknown Stripe error'
  const recoverable =
    code === 'authentication_required' ||
    code === 'card_declined' ||
    code === 'expired_card' ||
    code === 'insufficient_funds'
  return { failureCode: code, failureMessage: message, recoverable }
}

export async function chargeBalance(
  input: ChargeBalanceInput,
  actor: string,
): Promise<ChargeBalanceResult> {
  const stripe = getStripe()
  const idempotencyKey = buildIdempotencyKey('balance-charge', input.jobId)

  try {
    const intent = await stripe.paymentIntents.create(
      {
        amount: input.amountCents,
        currency: 'usd',
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        off_session: true,
        confirm: true,
        description: input.description,
        metadata: {
          jobId: input.jobId,
          customerEmail: input.customerEmail,
          purpose: 'balance-charge',
        },
      },
      { idempotencyKey },
    )

    logger.info(
      {
        jobId: input.jobId,
        paymentIntentId: intent.id,
        amountCents: input.amountCents,
        status: intent.status,
      },
      'stripe: balance charge succeeded',
    )

    await appendAuditRow({
      actor,
      action: 'balance.charged',
      target: input.jobId,
      after: JSON.stringify({
        paymentIntentId: intent.id,
        amountCents: input.amountCents,
        status: intent.status,
      }),
    })

    return {
      status: 'succeeded',
      paymentIntentId: intent.id,
      chargeId:
        typeof intent.latest_charge === 'string'
          ? intent.latest_charge
          : (intent.latest_charge?.id ?? null),
    }
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      const classification = classifyFailure(err)
      const paymentIntent = (err as unknown as { payment_intent?: Stripe.PaymentIntent }).payment_intent

      logger.warn(
        {
          jobId: input.jobId,
          customerEmail: maskEmail(input.customerEmail),
          paymentIntentId: paymentIntent?.id,
          failureCode: classification.failureCode,
          recoverable: classification.recoverable,
        },
        'stripe: balance charge failed',
      )

      await appendAuditRow({
        actor,
        action: 'balance.charge_failed',
        target: input.jobId,
        after: JSON.stringify({
          paymentIntentId: paymentIntent?.id ?? null,
          failureCode: classification.failureCode,
          failureMessage: classification.failureMessage,
        }),
      })

      if (classification.failureCode === 'authentication_required' && paymentIntent) {
        return {
          status: 'requires_action',
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret ?? null,
          nextAction: 'authentication-required',
        }
      }

      return {
        status: 'failed',
        paymentIntentId: paymentIntent?.id ?? null,
        ...classification,
      }
    }
    throw err
  }
}
