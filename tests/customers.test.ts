import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stage 14 (Phase B1) CRM read surface — lib/data/pg/customers.ts.
// Each assertion is a contract from docs/stage-14-crm-interface-design.md:
//  - listCustomers maps a customer_summary row to CustomerSummary with the
//    ALL-STRINGS discipline: deposits/counts are cent-STRINGS (never numbers),
//    timestamps ISO-normalized through new Date(v).toISOString(), and NO
//    null/undefined crosses the boundary (NULL columns coerce to '').
//  - getCustomerById('not-a-uuid') returns null WITHOUT a client call (the
//    uuid-typed .eq() would otherwise throw 22P02 on garbage — parity with the
//    repo's UUID gate; admin 404 pages rely on the null sentinel).
//  - properties grouping normalizes address (trim/lowercase/collapse-ws): a
//    customer with jobs at "12 Oak St ", "12 oak st", "5 Elm Ave" yields 2
//    properties with the correct per-property job counts.

// ---------------------------------------------------------------------------
// A spy-able fake supabase client. Every `.from(table)` records the table so a
// short-circuit (non-UUID id) can be asserted to NEVER touch the client. The
// terminal builders (.maybeSingle for the summary row, .range for the paginated
// jobs read) resolve a per-table configurable result.
// ---------------------------------------------------------------------------

const captured: {
  fromCalls: string[]
  updates: { table: string; payload: Record<string, unknown> }[]
} = { fromCalls: [], updates: [] }

// Per-table result the next terminal builder resolves. customer_summary is read
// via .eq().maybeSingle() (getCustomerById) or .order().order().range()
// (listCustomers); jobs via .eq().order().order().range().
let summaryRow: unknown = null
let summaryList: unknown[] = []
let jobsRows: unknown[] = []
// The payments ledger (total spent): read via .eq().order().range() for the
// list and .eq().in() for one profile.
let paymentsRows: unknown[] = []
// What an .update().eq().select() resolves to, per table.
let updateResult: Record<string, { data: unknown; error: unknown }> = {}

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  const rows = () => (table === 'jobs' ? jobsRows : table === 'payments' ? paymentsRows : summaryList)
  let updating = false
  builder.select = () => {
    if (updating) {
      return Promise.resolve(updateResult[table] ?? { data: [{ id: 'x' }], error: null })
    }
    return builder
  }
  builder.update = (payload: Record<string, unknown>) => {
    captured.updates.push({ table, payload })
    updating = true
    return builder
  }
  builder.eq = () => builder
  builder.order = () => builder
  // .in() terminal — one profile's payments.
  builder.in = () => Promise.resolve({ data: rows(), error: null })
  // .range() terminal — listCustomers (customer_summary), the jobs reads, and
  // the payments read.
  builder.range = () => Promise.resolve({ data: rows(), error: null })
  // .maybeSingle() terminal — getCustomerById's single customer_summary row.
  builder.maybeSingle = () => Promise.resolve({ data: summaryRow, error: null })
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

vi.mock('@/lib/security/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  captured.fromCalls = []
  captured.updates = []
  summaryRow = null
  summaryList = []
  jobsRows = []
  paymentsRows = []
  updateResult = {}
})

afterEach(() => {
  vi.resetModules()
})

// A full jobs row shaped for toContactRow — every field the mapper reads.
// Overrides let a test set only the columns it cares about (address, deposits).
function makeJobRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    customer_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    created_at: '2026-06-12T14:00:00.000Z',
    updated_at: '2026-06-12T14:00:00.000Z',
    submitted_at: '2026-06-12T14:00:00.000Z',
    name: '',
    phone: '',
    email: '',
    address: '',
    service_type: '',
    preferred_date: null,
    description: '',
    referral_source: '',
    status: 'New',
    complete_date: null,
    review_sent_at: null,
    review_send_count: null,
    review_received: false,
    seasonal_nudge_last_sent: null,
    opt_out: false,
    first_touch_sent_at: null,
    hours_to_first_touch: null,
    utm_source: '',
    stripe_customer_id: '',
    stripe_payment_method_id: '',
    deposit_paid_cents: null,
    balance_owed_cents: null,
    service_categories: [],
    property_type: '',
    urgency: '',
    best_contact_time: '',
    best_contact_method: '',
    photo_urls: [],
    is_returning_customer: false,
    prior_job_count: null,
    dispatch_status: '',
    dispatch_decision: '',
    dispatch_decided_at: null,
    telegram_message_id: '',
    legacy: null,
    anonymized_at: null,
    ...overrides,
  }
}

describe('listCustomers: maps a customer_summary row to the all-strings CustomerSummary', () => {
  it('returns deposits and counts as cent-STRINGS (never numbers), dates ISO-normalized, no null crosses the boundary', async () => {
    // A summary row straight off PostgREST: aggregates come back as numbers,
    // timestamps in PostgREST's microsecond/+00:00 shape, and the customer has
    // NULL phone/notes (a customer who never filled those in).
    summaryList = [
      {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        name: 'Jane Renter',
        phone: null,
        email: 'jane@example.com',
        notes: null,
        anonymized_at: null,
        created_at: '2026-01-01 09:00:00+00:00',
        job_count: 3,
        last_job_at: '2026-06-12 14:03:22.123456+00:00',
        first_job_at: '2026-01-15 10:00:00+00:00',
        deposits_collected_cents: 25000,
        property_count: 2,
      },
    ]
    const { listCustomers } = await import('@/lib/data/pg/customers')
    const [c] = await listCustomers()

    // Money is a cent-STRING, not a number.
    expect(c.depositsCollectedCents).toBe('25000')
    expect(typeof c.depositsCollectedCents).toBe('string')
    // Counts are STRINGS too.
    expect(c.jobCount).toBe('3')
    expect(c.propertyCount).toBe('2')
    expect(typeof c.jobCount).toBe('string')

    // Timestamps ISO-normalized through new Date(v).toISOString() — the
    // microsecond/+00:00 shape becomes the canonical millisecond Z form.
    expect(c.lastJobAt).toBe('2026-06-12T14:03:22.123Z')
    expect(c.firstJobAt).toBe('2026-01-15T10:00:00.000Z')

    // NULL columns coerce to '' — no null/undefined anywhere on the boundary.
    expect(c.phone).toBe('')
    expect(c.notes).toBe('')
    expect(c.anonymized).toBe(false)

    // Exhaustive: every value on the object is a defined string except the
    // single `anonymized` boolean.
    for (const [key, value] of Object.entries(c)) {
      if (key === 'anonymized') {
        expect(typeof value).toBe('boolean')
      } else {
        expect(value).not.toBeNull()
        expect(value).not.toBeUndefined()
        expect(typeof value).toBe('string')
      }
    }
  })

  it('a customer with zero jobs (NULL date aggregates) coerces dates to ""', async () => {
    summaryList = [
      {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        name: 'No Jobs Yet',
        phone: '555-0000',
        email: 'nojobs@example.com',
        notes: '',
        anonymized_at: null,
        created_at: '2026-06-01 09:00:00+00:00',
        job_count: 0,
        last_job_at: null,
        first_job_at: null,
        deposits_collected_cents: 0, // coalesce(...,0) in the view
        property_count: 0,
      },
    ]
    const { listCustomers } = await import('@/lib/data/pg/customers')
    const [c] = await listCustomers()
    expect(c.lastJobAt).toBe('')
    expect(c.firstJobAt).toBe('')
    expect(c.jobCount).toBe('0')
    expect(c.depositsCollectedCents).toBe('0')
  })
})

describe('getCustomerById: non-UUID short-circuits, properties group by normalized address', () => {
  it("returns null for 'not-a-uuid' WITHOUT calling the client", async () => {
    const { getCustomerById } = await import('@/lib/data/pg/customers')
    const result = await getCustomerById('not-a-uuid')
    expect(result).toBeNull()
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('returns null for an empty id without a client call', async () => {
    const { getCustomerById } = await import('@/lib/data/pg/customers')
    expect(await getCustomerById('')).toBeNull()
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('groups jobs at "12 Oak St ", "12 oak st", "5 Elm Ave" into 2 properties with correct counts', async () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    summaryRow = {
      id,
      name: 'Larry Landlord',
      phone: '555-1234',
      email: 'larry@example.com',
      notes: 'gate code 4242',
      anonymized_at: null,
      created_at: '2026-01-01 09:00:00+00:00',
      job_count: 3,
      last_job_at: '2026-06-12 14:00:00+00:00',
      first_job_at: '2026-01-15 10:00:00+00:00',
      deposits_collected_cents: 0,
      property_count: 2,
    }
    // Two jobs at the same address with cosmetic case/whitespace differences,
    // one at a distinct address. Normalization (trim/lowercase/collapse-ws)
    // must collapse the first two into one property.
    jobsRows = [
      makeJobRow({
        id: '00000000-0000-4000-8000-000000000001',
        address: '12 Oak St ',
        submitted_at: '2026-01-15T10:00:00.000Z',
      }),
      makeJobRow({
        id: '00000000-0000-4000-8000-000000000002',
        address: '12 oak st',
        submitted_at: '2026-03-20T10:00:00.000Z',
      }),
      makeJobRow({
        id: '00000000-0000-4000-8000-000000000003',
        address: '5 Elm Ave',
        submitted_at: '2026-06-12T14:00:00.000Z',
      }),
    ]

    const { getCustomerById } = await import('@/lib/data/pg/customers')
    const detail = await getCustomerById(id)
    expect(detail).not.toBeNull()

    // Two distinct properties.
    expect(detail!.properties).toHaveLength(2)

    // The "12 Oak St" group has 2 jobs; its representative address is the
    // first-seen original casing ('12 Oak St ') and the count is a STRING.
    const oak = detail!.properties.find((p) => p.address === '12 Oak St ')
    expect(oak).toBeDefined()
    expect(oak!.jobCount).toBe('2')
    expect(typeof oak!.jobCount).toBe('string')
    // lastJobAt is the most-recent of the group (lexicographic ISO max).
    expect(oak!.lastJobAt).toBe('2026-03-20T10:00:00.000Z')

    // The Elm Ave group has 1 job.
    const elm = detail!.properties.find((p) => p.address === '5 Elm Ave')
    expect(elm).toBeDefined()
    expect(elm!.jobCount).toBe('1')

    // The detail carries all three jobs and the summary fields.
    expect(detail!.jobs).toHaveLength(3)
    expect(detail!.name).toBe('Larry Landlord')
    expect(detail!.notes).toBe('gate code 4242')
  })

  it('skips blank/whitespace-only addresses — they are not a property (matches the view fix)', async () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000099'
    summaryRow = {
      id, name: 'Blank Address', phone: '', email: 'blank@example.com',
      notes: '', anonymized_at: null, created_at: '2026-01-01 09:00:00+00:00',
      job_count: 2, last_job_at: '2026-02-01 10:00:00+00:00',
      first_job_at: '2026-01-01 10:00:00+00:00', deposits_collected_cents: 0,
      property_count: 0,
    }
    jobsRows = [
      makeJobRow({ id: '00000000-0000-4000-8000-0000000000a1', address: '' }),
      makeJobRow({ id: '00000000-0000-4000-8000-0000000000a2', address: '   ' }),
    ]
    const { getCustomerById } = await import('@/lib/data/pg/customers')
    const detail = await getCustomerById(id)
    expect(detail!.properties).toHaveLength(0)
    expect(detail!.jobs).toHaveLength(2) // jobs still listed, just no property
  })

  it('blanks job PII on the profile when the customer is anonymized (read-side deletion guard)', async () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-0000000000de'
    summaryRow = {
      id, name: '[REDACTED]', phone: '[REDACTED]', email: `redacted:${id}`,
      notes: '', anonymized_at: '2026-05-01 09:00:00+00:00',
      created_at: '2026-01-01 09:00:00+00:00', job_count: 1,
      last_job_at: '2026-02-01 10:00:00+00:00', first_job_at: '2026-02-01 10:00:00+00:00',
      deposits_collected_cents: 0, property_count: 1,
    }
    // A job that somehow still carries raw PII (the divergent-match-key case):
    // the read guard must blank it because the customer is anonymized.
    jobsRows = [
      makeJobRow({
        id: '00000000-0000-4000-8000-0000000000d1',
        name: 'Jane Real', phone: '+19195551234', email: 'jane@real.com',
        address: '99 Real St', description: 'sensitive details',
      }),
    ]
    const { getCustomerById } = await import('@/lib/data/pg/customers')
    const detail = await getCustomerById(id)
    const job = detail!.jobs[0]
    expect(job.name).toBe('[REDACTED]')
    expect(job.phone).toBe('[REDACTED]')
    expect(job.email).toBe('[REDACTED]')
    expect(job.address).toBe('[REDACTED]')
    expect(job.description).toBe('[REDACTED]')
    // No original PII anywhere in the serialized detail.
    expect(JSON.stringify(detail)).not.toContain('jane@real.com')
    expect(JSON.stringify(detail)).not.toContain('Jane Real')
  })
})

const CUSTOMER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const JOB_A = '00000000-0000-4000-8000-00000000000a'
const JOB_B = '00000000-0000-4000-8000-00000000000b'

function summary(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CUSTOMER_ID,
    name: 'Jane Renter',
    phone: '',
    email: 'jane@example.com',
    notes: '',
    anonymized_at: null,
    created_at: '2026-01-01 09:00:00+00:00',
    job_count: 2,
    last_job_at: '2026-06-12 14:00:00+00:00',
    first_job_at: '2026-01-15 10:00:00+00:00',
    deposits_collected_cents: 10000,
    property_count: 1,
    ...overrides,
  }
}

describe('total spent: deposits + balance payments − refunds, from the payments ledger', () => {
  it('listCustomers rolls each customer up across their jobs, including balance-link payments', async () => {
    summaryList = [summary(), summary({ id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee', name: 'Nobody Paid' })]
    jobsRows = [
      { id: JOB_A, customer_id: CUSTOMER_ID, deposit_paid_cents: 10000 },
      { id: JOB_B, customer_id: CUSTOMER_ID, deposit_paid_cents: 0 },
    ]
    paymentsRows = [
      { job_id: JOB_A, purpose: 'deposit', status: 'succeeded', amount_cents: 10000 },
      { job_id: JOB_A, purpose: 'balance-link', status: 'succeeded', amount_cents: 11900 },
      { job_id: JOB_B, purpose: 'balance-charge', status: 'succeeded', amount_cents: 5000 },
      { job_id: JOB_B, purpose: 'refund', status: 'succeeded', amount_cents: 2000 },
    ]
    const { listCustomers } = await import('@/lib/data/pg/customers')
    const [jane, nobody] = await listCustomers()
    expect(jane.totalSpentCents).toBe('24900')
    expect(nobody.totalSpentCents).toBe('0')
  })

  it("falls back to the job's recorded deposit when its ledger row is missing", async () => {
    summaryList = [summary()]
    jobsRows = [{ id: JOB_A, customer_id: CUSTOMER_ID, deposit_paid_cents: 12500 }]
    paymentsRows = []
    const { listCustomers } = await import('@/lib/data/pg/customers')
    const [c] = await listCustomers()
    expect(c.totalSpentCents).toBe('12500')
  })

  it('getCustomerById totals only that customer\'s jobs', async () => {
    summaryRow = summary()
    jobsRows = [makeJobRow({ id: JOB_A, deposit_paid_cents: 10000 })]
    paymentsRows = [
      { job_id: JOB_A, purpose: 'deposit', status: 'succeeded', amount_cents: 10000 },
      { job_id: JOB_A, purpose: 'balance-charge', status: 'succeeded', amount_cents: 4000 },
    ]
    const { getCustomerById } = await import('@/lib/data/pg/customers')
    const c = await getCustomerById(CUSTOMER_ID)
    expect(c?.totalSpentCents).toBe('14000')
  })
})

describe('placeholder emails never reach the read surface', () => {
  it("shows '' for unknown:/redacted: placeholders, the real address otherwise", async () => {
    summaryList = [
      summary({ email: 'unknown:3f1c2b9e-0000-4000-8000-000000000000' }),
      summary({ id: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee', email: 'redacted:abc' }),
      summary({ id: 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee', email: 'real@example.com' }),
    ]
    const { listCustomers } = await import('@/lib/data/pg/customers')
    const rows = await listCustomers()
    expect(rows.map((r) => r.email)).toEqual(['', '', 'real@example.com'])
  })
})

describe('updateCustomerContact: writes the customer, then copies the change to their jobs', () => {
  it('writes only the fields given, to both tables, and counts the jobs', async () => {
    updateResult = { jobs: { data: [{ id: JOB_A }, { id: JOB_B }], error: null } }
    const { updateCustomerContact } = await import('@/lib/data/pg/customers')
    const res = await updateCustomerContact(CUSTOMER_ID, { phone: '9195550142', email: 'new@example.com' })
    expect(res).toEqual({ ok: true, jobsUpdated: 2 })
    expect(captured.updates).toEqual([
      { table: 'customers', payload: { phone: '9195550142', email: 'new@example.com' } },
      { table: 'jobs', payload: { phone: '9195550142', email: 'new@example.com' } },
    ])
  })

  it("clears an email to a fresh unknown: placeholder on the customer and '' on the jobs", async () => {
    const { updateCustomerContact } = await import('@/lib/data/pg/customers')
    await updateCustomerContact(CUSTOMER_ID, { email: '' })
    const [customer, jobs] = captured.updates
    expect(String(customer.payload.email)).toMatch(/^unknown:[0-9a-f-]{36}$/)
    expect(jobs.payload.email).toBe('')
  })

  it('returns duplicate on a unique-email conflict and leaves the jobs alone', async () => {
    updateResult = { customers: { data: null, error: { code: '23505', message: 'dup' } } }
    const { updateCustomerContact } = await import('@/lib/data/pg/customers')
    const res = await updateCustomerContact(CUSTOMER_ID, { email: 'taken@example.com' })
    expect(res).toEqual({ ok: false, reason: 'duplicate' })
    expect(captured.updates.map((u) => u.table)).toEqual(['customers'])
  })

  it('returns not_found for a non-UUID id without touching the client', async () => {
    const { updateCustomerContact } = await import('@/lib/data/pg/customers')
    expect(await updateCustomerContact('nope', { name: 'X' })).toEqual({ ok: false, reason: 'not_found' })
    expect(captured.fromCalls).toEqual([])
  })
})
