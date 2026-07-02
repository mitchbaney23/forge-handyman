import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'

// handleChargeRefunded (lib/stripe/webhook-handlers.ts). The contract:
//  - a jobId on charge.metadata flips the job with NO Stripe API round-trip;
//  - dashboard refunds/chargebacks (no charge metadata) resolve the jobId
//    through the parent PaymentIntent's metadata — where both the deposit
//    payment link (payment_intent_data) and the balance charge stamp it;
//  - an unresolvable jobId surfaces to Sentry (money moved with no book
//    entry) and skips the status flip;
//  - a failed PI retrieve propagates so the route releases the idempotency
//    claim and Stripe retries;
//  - full refunds flip to 'Refunded', partial to 'Partial Refund', and the
//    ledger records the CUMULATIVE amount via recordRefund.

const captured = {
  rowUpdates: [] as { jobId: string; patch: Record<string, string> }[],
  auditRows: [] as Record<string, unknown>[],
  refunds: [] as Record<string, unknown>[],
  retrieves: [] as string[],
  sentryMessages: [] as string[],
}
let piResult: { metadata: Record<string, string> } | Error = { metadata: {} }

vi.mock('@/lib/data', () => ({
  updateRowByJobId: (jobId: string, patch: Record<string, string>) => {
    captured.rowUpdates.push({ jobId, patch })
    return Promise.resolve({ updated: true })
  },
  appendAuditRow: (row: Record<string, unknown>) => {
    captured.auditRows.push(row)
    return Promise.resolve()
  },
}))
vi.mock('@/lib/data/backend', () => ({ getBackend: () => 'postgres' }))
vi.mock('@/lib/data/pg/payments', () => ({
  recordPayment: () => Promise.resolve(),
  reconcileAttempt: () => Promise.resolve(),
  recordRefund: (args: Record<string, unknown>) => {
    captured.refunds.push(args)
    return Promise.resolve()
  },
}))
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    paymentIntents: {
      retrieve: (id: string) => {
        captured.retrieves.push(id)
        return piResult instanceof Error ? Promise.reject(piResult) : Promise.resolve(piResult)
      },
    },
  }),
}))
vi.mock('@sentry/nextjs', () => ({
  captureException: () => undefined,
  captureMessage: (msg: string) => {
    captured.sentryMessages.push(msg)
    return undefined
  },
}))
vi.mock('@/lib/security/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  maskEmail: (v: string | undefined) => v ?? '',
}))

function refundEvent(charge: Partial<Stripe.Charge>): Stripe.Event {
  return {
    id: 'evt_refund_1',
    type: 'charge.refunded',
    data: { object: charge },
  } as unknown as Stripe.Event
}

beforeEach(() => {
  captured.rowUpdates = []
  captured.auditRows = []
  captured.refunds = []
  captured.retrieves = []
  captured.sentryMessages = []
  piResult = { metadata: {} }
})
afterEach(() => vi.resetModules())

describe('handleChargeRefunded', () => {
  it('uses charge.metadata.jobId directly — no PI round-trip', async () => {
    const { handleChargeRefunded } = await import('@/lib/stripe/webhook-handlers')
    await handleChargeRefunded(
      refundEvent({
        id: 'ch_1',
        metadata: { jobId: 'job-1' } as Stripe.Metadata,
        refunded: true,
        amount_refunded: 5000,
      }),
    )
    expect(captured.retrieves).toHaveLength(0)
    expect(captured.rowUpdates).toEqual([{ jobId: 'job-1', patch: { status: 'Refunded' } }])
  })

  it('falls back to the parent PaymentIntent metadata for a dashboard refund (bare charge)', async () => {
    piResult = { metadata: { jobId: 'job-2' } }
    const { handleChargeRefunded } = await import('@/lib/stripe/webhook-handlers')
    await handleChargeRefunded(
      refundEvent({
        id: 'ch_2',
        metadata: {} as Stripe.Metadata,
        payment_intent: 'pi_2',
        refunded: true,
        amount_refunded: 12000,
      }),
    )
    expect(captured.retrieves).toEqual(['pi_2'])
    expect(captured.rowUpdates).toEqual([{ jobId: 'job-2', patch: { status: 'Refunded' } }])
    expect(captured.refunds).toEqual([
      {
        jobId: 'job-2',
        amountRefundedCents: 12000,
        stripeChargeId: 'ch_2',
        stripePaymentIntentId: 'pi_2',
      },
    ])
  })

  it('extracts the PI id for the ledger when charge.payment_intent arrives expanded (object, not string)', async () => {
    piResult = { metadata: { jobId: 'job-6' } }
    const { handleChargeRefunded } = await import('@/lib/stripe/webhook-handlers')
    await handleChargeRefunded(
      refundEvent({
        id: 'ch_6',
        metadata: {} as Stripe.Metadata,
        payment_intent: { id: 'pi_6' } as Stripe.PaymentIntent,
        refunded: true,
        amount_refunded: 7000,
      }),
    )
    expect(captured.retrieves).toEqual(['pi_6'])
    expect(captured.refunds).toEqual([
      {
        jobId: 'job-6',
        amountRefundedCents: 7000,
        stripeChargeId: 'ch_6',
        stripePaymentIntentId: 'pi_6',
      },
    ])
  })

  it('flips to Partial Refund when the charge is not fully refunded', async () => {
    const { handleChargeRefunded } = await import('@/lib/stripe/webhook-handlers')
    await handleChargeRefunded(
      refundEvent({
        id: 'ch_3',
        metadata: { jobId: 'job-3' } as Stripe.Metadata,
        refunded: false,
        amount_refunded: 2500,
      }),
    )
    expect(captured.rowUpdates).toEqual([{ jobId: 'job-3', patch: { status: 'Partial Refund' } }])
  })

  it('surfaces an unresolvable jobId to Sentry and skips the status flip', async () => {
    piResult = { metadata: {} }
    const { handleChargeRefunded } = await import('@/lib/stripe/webhook-handlers')
    await handleChargeRefunded(
      refundEvent({
        id: 'ch_4',
        metadata: {} as Stripe.Metadata,
        payment_intent: 'pi_4',
        refunded: true,
        amount_refunded: 900,
      }),
    )
    expect(captured.rowUpdates).toHaveLength(0)
    expect(captured.refunds).toHaveLength(0)
    expect(captured.sentryMessages).toEqual(['Stripe refund with unresolvable jobId'])
  })

  it('propagates a failed PI retrieve so the route releases the claim and Stripe retries', async () => {
    piResult = new Error('stripe blip')
    const { handleChargeRefunded } = await import('@/lib/stripe/webhook-handlers')
    await expect(
      handleChargeRefunded(
        refundEvent({
          id: 'ch_5',
          metadata: {} as Stripe.Metadata,
          payment_intent: 'pi_5',
          refunded: true,
          amount_refunded: 900,
        }),
      ),
    ).rejects.toThrow('stripe blip')
    expect(captured.rowUpdates).toHaveLength(0)
  })
})
