import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Phase B2 payments guard layer (lib/data/pg/payments.ts). The contract:
//  - a non-UUID jobId short-circuits WITHOUT touching the client (parity with
//    the repo's UUID gate — a uuid-typed column would otherwise throw 22P02);
//  - claimChargeAttempt returns the inserted row when it won the gate, or null
//    on conflict (the RPC returns no row) — "null" is the double-charge gate;
//  - reconcileAttempt / recordPayment no-op on a non-UUID jobId.

const captured = {
  rpcCalls: [] as { fn: string; args: unknown }[],
  fromCalls: [] as string[],
  updates: [] as unknown[],
  inserts: [] as unknown[],
}
let rpcResult: { data: unknown; error: unknown } = { data: null, error: null }
let selectResult: { data: unknown; error: unknown } = { data: null, error: null }

function makeBuilder() {
  let result: { data?: unknown; error: unknown } = { data: null, error: null }
  const b: Record<string, unknown> = {
    select: () => {
      result = selectResult
      return b
    },
    eq: () => b,
    in: () => b,
    order: () => b,
    limit: () => {
      result = selectResult
      return b
    },
    update: (patch: unknown) => {
      captured.updates.push(patch)
      result = { error: null }
      return b
    },
    insert: (payload: unknown) => {
      captured.inserts.push(payload)
      result = { error: null }
      return b
    },
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  }
  return b
}

vi.mock('@/lib/data/pg/client', () => ({
  getSupabaseClient: () => ({
    rpc: (fn: string, args: unknown) => {
      captured.rpcCalls.push({ fn, args })
      return Promise.resolve(rpcResult)
    },
    from: (table: string) => {
      captured.fromCalls.push(table)
      return makeBuilder()
    },
  }),
}))

const UUID = '11111111-2222-4333-8444-555555555555'

beforeEach(() => {
  captured.rpcCalls = []
  captured.fromCalls = []
  captured.updates = []
  captured.inserts = []
  rpcResult = { data: null, error: null }
  selectResult = { data: null, error: null }
})
afterEach(() => vi.resetModules())

describe('claimChargeAttempt', () => {
  it('returns null for a non-UUID jobId WITHOUT calling the client', async () => {
    const { claimChargeAttempt } = await import('@/lib/data/pg/payments')
    const res = await claimChargeAttempt({
      jobId: 'not-a-uuid',
      purpose: 'balance-charge',
      amountCents: 5000,
      idempotencyKey: 'k',
      stripeCustomerId: 'cus_x',
    })
    expect(res).toBeNull()
    expect(captured.rpcCalls).toHaveLength(0)
  })

  it('returns the mapped row when it WON the gate (rpc returned a row)', async () => {
    rpcResult = {
      data: { id: 'pay_1', job_id: UUID, purpose: 'balance-charge', status: 'pending', amount_cents: 5000 },
      error: null,
    }
    const { claimChargeAttempt } = await import('@/lib/data/pg/payments')
    const res = await claimChargeAttempt({
      jobId: UUID,
      purpose: 'balance-charge',
      amountCents: 5000,
      idempotencyKey: 'balance-charge:' + UUID,
      stripeCustomerId: 'cus_x',
    })
    expect(res).not.toBeNull()
    expect(res!.id).toBe('pay_1')
    expect(res!.status).toBe('pending')
    expect(res!.amountCents).toBe(5000)
    expect(captured.rpcCalls[0].fn).toBe('claim_charge_attempt')
  })

  it('returns null on CONFLICT (rpc returned no row) — the double-charge gate', async () => {
    rpcResult = { data: null, error: null }
    const { claimChargeAttempt } = await import('@/lib/data/pg/payments')
    const res = await claimChargeAttempt({
      jobId: UUID,
      purpose: 'balance-charge',
      amountCents: 5000,
      idempotencyKey: 'k',
      stripeCustomerId: 'cus_x',
    })
    expect(res).toBeNull()
    expect(captured.rpcCalls).toHaveLength(1) // it DID try (unlike the non-uuid case)
  })

  it('unwraps an array result shape (setof => [row])', async () => {
    rpcResult = { data: [{ id: 'pay_2', job_id: UUID, status: 'pending', amount_cents: 100 }], error: null }
    const { claimChargeAttempt } = await import('@/lib/data/pg/payments')
    const res = await claimChargeAttempt({
      jobId: UUID, purpose: 'balance-charge', amountCents: 100, idempotencyKey: 'k', stripeCustomerId: '',
    })
    expect(res!.id).toBe('pay_2')
  })

  it('treats an empty array (setof conflict) as null', async () => {
    rpcResult = { data: [], error: null }
    const { claimChargeAttempt } = await import('@/lib/data/pg/payments')
    const res = await claimChargeAttempt({
      jobId: UUID, purpose: 'balance-charge', amountCents: 100, idempotencyKey: 'k', stripeCustomerId: '',
    })
    expect(res).toBeNull()
  })

  it('treats an ALL-NULL composite row (legacy conflict sentinel) as null — NOT a win', async () => {
    // The pre-fix `returns payments` shape: PostgREST emits a row of all-null
    // fields on conflict. A truthy-but-idless object must read as "blocked",
    // never as "claimed" (that bug would double-charge).
    rpcResult = {
      data: { id: null, job_id: null, purpose: null, status: null, amount_cents: null },
      error: null,
    }
    const { claimChargeAttempt } = await import('@/lib/data/pg/payments')
    const res = await claimChargeAttempt({
      jobId: UUID, purpose: 'balance-charge', amountCents: 100, idempotencyKey: 'k', stripeCustomerId: '',
    })
    expect(res).toBeNull()
  })
})

describe('findLiveAttempt', () => {
  it('returns null for a non-UUID jobId without a client call', async () => {
    const { findLiveAttempt } = await import('@/lib/data/pg/payments')
    expect(await findLiveAttempt('garbage', 'balance-charge')).toBeNull()
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('maps the live row when present', async () => {
    selectResult = { data: [{ id: 'pay_3', job_id: UUID, status: 'succeeded', amount_cents: 7500 }], error: null }
    const { findLiveAttempt } = await import('@/lib/data/pg/payments')
    const row = await findLiveAttempt(UUID, 'balance-charge')
    expect(row!.status).toBe('succeeded')
    expect(row!.amountCents).toBe(7500)
  })
})

describe('reconcileAttempt / recordPayment', () => {
  it('reconcileAttempt no-ops on a non-UUID jobId (no client call)', async () => {
    const { reconcileAttempt } = await import('@/lib/data/pg/payments')
    await reconcileAttempt('garbage', 'balance-charge', { status: 'succeeded' })
    expect(captured.fromCalls).toHaveLength(0)
    expect(captured.updates).toHaveLength(0)
  })

  it('reconcileAttempt patches status + ids for a valid job', async () => {
    const { reconcileAttempt } = await import('@/lib/data/pg/payments')
    await reconcileAttempt(UUID, 'balance-charge', {
      status: 'succeeded',
      stripePaymentIntentId: 'pi_1',
      stripeChargeId: 'ch_1',
    })
    expect(captured.updates).toHaveLength(1)
    const patch = captured.updates[0] as Record<string, unknown>
    expect(patch.status).toBe('succeeded')
    expect(patch.stripe_payment_intent_id).toBe('pi_1')
    expect(patch.stripe_charge_id).toBe('ch_1')
  })

  it('recordPayment no-ops on a non-UUID jobId', async () => {
    const { recordPayment } = await import('@/lib/data/pg/payments')
    await recordPayment({ jobId: 'garbage', purpose: 'deposit', status: 'succeeded', amountCents: 100 })
    expect(captured.inserts).toHaveLength(0)
  })

  it('recordPayment inserts a ledger row for a valid job', async () => {
    const { recordPayment } = await import('@/lib/data/pg/payments')
    await recordPayment({ jobId: UUID, purpose: 'deposit', status: 'succeeded', amountCents: 2500, stripePaymentIntentId: 'pi_d' })
    expect(captured.inserts).toHaveLength(1)
    const row = captured.inserts[0] as Record<string, unknown>
    expect(row.purpose).toBe('deposit')
    expect(row.amount_cents).toBe(2500)
  })
})

describe('recordRefund', () => {
  it('no-ops on a non-UUID jobId (no client call)', async () => {
    const { recordRefund } = await import('@/lib/data/pg/payments')
    await recordRefund({ jobId: 'garbage', amountRefundedCents: 500, stripeChargeId: 'ch_1' })
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('inserts a refund row when none exists for the charge', async () => {
    selectResult = { data: [], error: null }
    const { recordRefund } = await import('@/lib/data/pg/payments')
    await recordRefund({
      jobId: UUID,
      amountRefundedCents: 2500,
      stripeChargeId: 'ch_1',
      stripePaymentIntentId: 'pi_1',
    })
    expect(captured.updates).toHaveLength(0)
    expect(captured.inserts).toHaveLength(1)
    const row = captured.inserts[0] as Record<string, unknown>
    expect(row.purpose).toBe('refund')
    expect(row.status).toBe('succeeded')
    expect(row.amount_cents).toBe(2500)
    expect(row.stripe_charge_id).toBe('ch_1')
  })

  it('REPLACES the existing row for the charge — amount_refunded is cumulative, a second row would double-count', async () => {
    selectResult = { data: [{ id: 'pay-1' }], error: null }
    const { recordRefund } = await import('@/lib/data/pg/payments')
    await recordRefund({ jobId: UUID, amountRefundedCents: 5000, stripeChargeId: 'ch_1' })
    expect(captured.inserts).toHaveLength(0)
    expect(captured.updates).toEqual([{ amount_cents: 5000 }])
  })
})
