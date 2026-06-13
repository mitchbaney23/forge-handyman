import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Repo + audit contracts (docs/stage-13-postgres-design.md "Repo contracts").
// Each assertion is a critique finding:
//  - non-UUID jobId resolves the sheet sentinel WITHOUT touching the client
//    (admin 404s, malformed Stripe metadata, Telegram callbacks rely on this;
//     a uuid-typed pg column would otherwise throw 22P02).
//  - appendAuditRow with a non-UUID target inserts job_id null (the activities
//    log has NO FK and must accept any target).
//  - redactCustomerByEmail's update payload carries no original PII and the
//    email becomes a 'redacted:' sentinel.

// A spy-able fake supabase client. Every `.from(table)` records the table and
// the operation chain; terminal builders resolve a configurable result. The
// key property under test: when a repo method short-circuits on a non-UUID id,
// `from` must NEVER be called.
type Captured = {
  fromCalls: string[]
  inserted: { table: string; payload: unknown }[]
  updated: { table: string; payload: unknown }[]
}

const captured: Captured = { fromCalls: [], inserted: [], updated: [] }

// Result the next terminal builder resolves. Tests tweak this for "row found"
// vs "no row" paths.
let nextSelectResult: { data: unknown; error: unknown } = { data: null, error: null }

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.neq = () => builder
  builder.in = () => builder
  builder.order = () => builder
  builder.range = () => Promise.resolve(nextSelectResult)
  builder.maybeSingle = () => Promise.resolve(nextSelectResult)
  builder.single = () => Promise.resolve(nextSelectResult)
  builder.insert = (payload: unknown) => {
    captured.inserted.push({ table, payload })
    // .insert() may or may not be chained with .select(); support both by
    // being a thenable that also returns `builder` for chaining.
    const thenable = {
      ...builder,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
    }
    return thenable
  }
  builder.update = (payload: unknown) => {
    captured.updated.push({ table, payload })
    return builder
  }
  // .update().eq().select() resolves nextSelectResult via .select() returning
  // a thenable.
  builder.select = (() => {
    const sel: Record<string, unknown> = { ...builder }
    sel.then = (resolve: (v: unknown) => unknown) => resolve(nextSelectResult)
    return () => sel
  })()
  return builder
}

vi.mock('@/lib/data/pg/client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table)
      return makeBuilder(table)
    },
  }),
}))

// Silence the pino logger (no console noise; also confirms we don't depend on
// its behavior).
vi.mock('@/lib/security/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  captured.fromCalls = []
  captured.inserted = []
  captured.updated = []
  nextSelectResult = { data: null, error: null }
})

afterEach(() => {
  vi.resetModules()
})

describe('findRowByJobId: non-UUID short-circuits without a client call', () => {
  it("returns null for 'not-a-uuid' WITHOUT calling the client", async () => {
    const { findRowByJobId } = await import('@/lib/data/pg/repo')
    const result = await findRowByJobId('not-a-uuid')
    expect(result).toBeNull()
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('returns null for empty string without a client call', async () => {
    const { findRowByJobId } = await import('@/lib/data/pg/repo')
    expect(await findRowByJobId('')).toBeNull()
    expect(captured.fromCalls).toHaveLength(0)
  })
})

describe('updateRowByJobId: non-UUID resolves {updated:false} without a client call', () => {
  it("returns {updated:false} for 'garbage' and never touches the client", async () => {
    const { updateRowByJobId } = await import('@/lib/data/pg/repo')
    const result = await updateRowByJobId('garbage', {})
    expect(result).toEqual({ updated: false })
    expect(captured.fromCalls).toHaveLength(0)
  })
})

describe('appendAuditRow: non-UUID target inserts job_id null', () => {
  it('sets activities.job_id = null for a non-UUID target', async () => {
    const { appendAuditRow } = await import('@/lib/data/pg/audit')
    await appendAuditRow({ actor: 'system', action: 'note', target: 'not-a-uuid' })
    expect(captured.inserted).toHaveLength(1)
    const payload = captured.inserted[0].payload as { job_id: unknown; target: string }
    expect(payload.job_id).toBeNull()
    expect(payload.target).toBe('not-a-uuid')
  })

  it('sets activities.job_id to the UUID when target is UUID-shaped', async () => {
    const { appendAuditRow } = await import('@/lib/data/pg/audit')
    const uuid = '11111111-2222-4333-8444-555555555555'
    await appendAuditRow({ actor: 'system', action: 'status', target: uuid })
    const payload = captured.inserted[0].payload as { job_id: unknown }
    expect(payload.job_id).toBe(uuid)
  })

  it('opportunistically parses JSON before/after into data; plain strings stay out', async () => {
    const { appendAuditRow } = await import('@/lib/data/pg/audit')
    await appendAuditRow({
      actor: 'stripe',
      action: 'charge',
      target: 'not-a-uuid',
      before: 'New',
      after: '{"payment_intent_id":"pi_123"}',
    })
    const payload = captured.inserted[0].payload as { data: { before?: unknown; after?: unknown } | null }
    expect(payload.data).not.toBeNull()
    expect(payload.data?.after).toEqual({ payment_intent_id: 'pi_123' })
    expect(payload.data?.before).toBeUndefined() // 'New' is not an object/array
  })
})

describe('redactCustomerByEmail: no original PII in the update payload', () => {
  it("redacts PII and sets email to a 'redacted:' sentinel", async () => {
    // One row updated so the function reports { updated: true }.
    nextSelectResult = { data: [{ id: 'abc' }], error: null }
    const { redactCustomerByEmail } = await import('@/lib/data/pg/repo')
    const result = await redactCustomerByEmail('jane@example.com')
    expect(result).toEqual({ updated: true })

    expect(captured.updated).toHaveLength(1)
    const payload = captured.updated[0].payload as Record<string, string>
    // PII fields scrubbed.
    expect(payload.name).toBe('[REDACTED]')
    expect(payload.phone).toBe('[REDACTED]')
    expect(payload.notes).toBe('')
    // Email is a unique sentinel — no original address survives.
    expect(payload.email).toMatch(/^redacted:/)
    expect(payload.email).not.toContain('jane@example.com')
    // anonymized_at stamped.
    expect(payload.anonymized_at).toBeDefined()

    // The whole payload must contain no original PII anywhere.
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('jane@example.com')
  })

  it('returns {updated:false} for an empty email without touching the client', async () => {
    const { redactCustomerByEmail } = await import('@/lib/data/pg/repo')
    expect(await redactCustomerByEmail('')).toEqual({ updated: false })
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('returns {updated:false} when no customer row matched', async () => {
    nextSelectResult = { data: [], error: null }
    const { redactCustomerByEmail } = await import('@/lib/data/pg/repo')
    expect(await redactCustomerByEmail('absent@example.com')).toEqual({ updated: false })
  })
})

describe('redactJobLegacyByIds: clears the PII-bearing legacy stash on deletion', () => {
  const ID_A = '11111111-2222-4333-8444-555555555555'
  const ID_B = '99999999-8888-4777-8666-555555555555'

  it('nulls jobs.legacy for the given ids and reports the count', async () => {
    nextSelectResult = { data: [{ id: ID_A }, { id: ID_B }], error: null }
    const { redactJobLegacyByIds } = await import('@/lib/data/pg/repo')
    const result = await redactJobLegacyByIds([ID_A, ID_B])
    expect(result).toEqual({ updated: 2 })
    // The update payload nulls legacy and carries NO original PII.
    expect(captured.updated).toHaveLength(1)
    const payload = captured.updated[0].payload as Record<string, unknown>
    expect(payload).toEqual({ legacy: null })
  })

  it('returns {updated:0} for an empty id list without touching the client', async () => {
    const { redactJobLegacyByIds } = await import('@/lib/data/pg/repo')
    expect(await redactJobLegacyByIds([])).toEqual({ updated: 0 })
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('drops non-UUID ids and no-ops when none remain', async () => {
    const { redactJobLegacyByIds } = await import('@/lib/data/pg/repo')
    expect(await redactJobLegacyByIds(['not-a-uuid', ''])).toEqual({ updated: 0 })
    expect(captured.fromCalls).toHaveLength(0)
  })
})
