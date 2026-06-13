import Stripe from 'stripe'
import { buildIdempotencyKey, getStripe } from '@/lib/stripe/client'
import { appendAuditRow } from '@/lib/data'
import { logger } from '@/lib/security/logger'

export interface RefundInput {
  jobId: string
  chargeId: string
  amountCents?: number
  reason?: 'duplicate' | 'fraudulent' | 'requested_by_customer'
  notes?: string
}

export type RefundResult =
  | { status: 'succeeded'; refundId: string; amountCents: number }
  | { status: 'failed'; failureCode: string | null; failureMessage: string }

export async function refundCharge(
  input: RefundInput,
  actor: string,
): Promise<RefundResult> {
  const stripe = getStripe()
  const idempotencyKey = buildIdempotencyKey(
    'refund',
    input.jobId,
    input.chargeId,
    String(input.amountCents ?? 'full'),
  )

  try {
    const refund = await stripe.refunds.create(
      {
        charge: input.chargeId,
        ...(input.amountCents !== undefined ? { amount: input.amountCents } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        metadata: {
          jobId: input.jobId,
          initiator: actor,
        },
      },
      { idempotencyKey },
    )

    logger.info(
      {
        jobId: input.jobId,
        refundId: refund.id,
        chargeId: input.chargeId,
        amountCents: refund.amount,
      },
      'stripe: refund issued',
    )

    await appendAuditRow({
      actor,
      action: 'refund.issued',
      target: input.jobId,
      after: JSON.stringify({
        refundId: refund.id,
        chargeId: input.chargeId,
        amountCents: refund.amount,
        reason: input.reason ?? null,
      }),
      notes: input.notes,
    })

    return {
      status: 'succeeded',
      refundId: refund.id,
      amountCents: refund.amount,
    }
  } catch (err) {
    if (err instanceof Stripe.errors.StripeError) {
      logger.error(
        {
          jobId: input.jobId,
          chargeId: input.chargeId,
          failureCode: err.code,
          failureMessage: err.message,
        },
        'stripe: refund failed',
      )

      await appendAuditRow({
        actor,
        action: 'refund.failed',
        target: input.jobId,
        after: JSON.stringify({
          chargeId: input.chargeId,
          failureCode: err.code ?? null,
          failureMessage: err.message,
        }),
        notes: input.notes,
      })

      return {
        status: 'failed',
        failureCode: err.code ?? null,
        failureMessage: err.message,
      }
    }
    throw err
  }
}
