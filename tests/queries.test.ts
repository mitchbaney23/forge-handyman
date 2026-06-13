import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { groupJobsForOverview, type JobRow } from '@/lib/sheet/queries'

// Two concerns (docs/stage-13-postgres-design.md "Tests + CI"):
//  1. groupJobsForOverview routing/sorting (pure — sheet module, backend-shared).
//  2. pg/queries listJobs pagination: PostgREST caps pages at 1000 rows, so the
//     loop must stitch 1000 + 1000 + 37 into 2037 with stable order params.

// ---------------------------------------------------------------------------
// groupJobsForOverview fixtures
// ---------------------------------------------------------------------------

function job(overrides: Partial<JobRow>): JobRow {
  return {
    submitted_at: '2026-06-10T10:00:00.000Z',
    name: '',
    phone: '',
    email: '',
    address: '',
    service_type: '',
    preferred_date: '',
    description: '',
    referral_source: '',
    status: 'New',
    rowNumber: 2,
    ...overrides,
  }
}

describe('groupJobsForOverview: status routing', () => {
  it("routes 'New' to needsTriage", () => {
    const result = groupJobsForOverview([job({ status: 'New' })])
    expect(result.needsTriage).toHaveLength(1)
    expect(result.openQuotes).toHaveLength(0)
  })

  it("routes 'Quoted' and 'Pending Follow-Up' to openQuotes", () => {
    const result = groupJobsForOverview([
      job({ status: 'Quoted' }),
      job({ status: 'Pending Follow-Up' }),
    ])
    expect(result.openQuotes).toHaveLength(2)
  })

  it("routes active jobs (Booked/In Progress) to today/tomorrow by preferred_date", () => {
    const today = new Date()
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const todayYmd = today.toISOString().slice(0, 10)
    const tomorrowYmd = tomorrow.toISOString().slice(0, 10)

    const result = groupJobsForOverview([
      job({ status: 'Booked', preferred_date: todayYmd }),
      job({ status: 'In Progress', preferred_date: tomorrowYmd }),
    ])
    expect(result.today).toHaveLength(1)
    expect(result.tomorrow).toHaveLength(1)
  })

  it("routes recent 'Complete' jobs (≤7 days) to recentlyComplete, excludes older", () => {
    const recent = new Date()
    recent.setDate(recent.getDate() - 2)
    const old = new Date()
    old.setDate(old.getDate() - 30)

    const result = groupJobsForOverview([
      job({ status: 'Complete', complete_date: recent.toISOString() }),
      job({ status: 'Complete', complete_date: old.toISOString() }),
    ])
    expect(result.recentlyComplete).toHaveLength(1)
  })

  it('ignores active jobs whose preferred_date is neither today nor tomorrow', () => {
    const result = groupJobsForOverview([job({ status: 'Booked', preferred_date: '2020-01-01' })])
    expect(result.today).toHaveLength(0)
    expect(result.tomorrow).toHaveLength(0)
  })
})

describe('groupJobsForOverview: sorting', () => {
  it('needsTriage sorts newest submitted_at first (desc)', () => {
    const result = groupJobsForOverview([
      job({ status: 'New', submitted_at: '2026-06-01T10:00:00.000Z', name: 'older' }),
      job({ status: 'New', submitted_at: '2026-06-10T10:00:00.000Z', name: 'newer' }),
    ])
    expect(result.needsTriage.map((j) => j.name)).toEqual(['newer', 'older'])
  })

  it('openQuotes sorts oldest submitted_at first (asc)', () => {
    const result = groupJobsForOverview([
      job({ status: 'Quoted', submitted_at: '2026-06-10T10:00:00.000Z', name: 'newer' }),
      job({ status: 'Quoted', submitted_at: '2026-06-01T10:00:00.000Z', name: 'older' }),
    ])
    expect(result.openQuotes.map((j) => j.name)).toEqual(['older', 'newer'])
  })

  it('recentlyComplete sorts newest complete_date first (desc)', () => {
    const a = new Date()
    a.setDate(a.getDate() - 1)
    const b = new Date()
    b.setDate(b.getDate() - 5)
    const result = groupJobsForOverview([
      job({ status: 'Complete', complete_date: b.toISOString(), name: 'older' }),
      job({ status: 'Complete', complete_date: a.toISOString(), name: 'newer' }),
    ])
    expect(result.recentlyComplete.map((j) => j.name)).toEqual(['newer', 'older'])
  })
})

// ---------------------------------------------------------------------------
// listJobs pagination — mock the supabase client module
// ---------------------------------------------------------------------------

// Capture the .order() params the query builder receives so we can assert a
// stable order is requested. Shared across the mock factory and the test via
// a module-level array (reset in beforeEach).
const orderCalls: { column: string; ascending: boolean | undefined }[] = []

// PostgREST returns at most PAGE_SIZE (1000) rows per .range() call; listJobs
// must loop until a short page. We serve 1000, 1000, 37 (total 2037).
const PAGES = [1000, 1000, 37]

function makeDbRow(id: number): Record<string, unknown> {
  // Minimal jobs row shaped for toContactRow — every field the mapper reads.
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    customer_id: '99999999-0000-4000-8000-000000000000',
    created_at: '2026-06-12T14:00:00.000Z',
    updated_at: '2026-06-12T14:00:00.000Z',
    submitted_at: '2026-06-12T14:00:00.000Z',
    name: `Job ${id}`,
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
  }
}

// vi.mock is hoisted; the factory must be self-contained (no outer refs except
// vi). We rebuild a fresh query-builder per .from() whose .range(from,to)
// resolves the page that covers `from`.
vi.mock('@/lib/data/pg/client', () => {
  return {
    getSupabaseClient: () => ({
      from: () => {
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.order = (column: string, opts?: { ascending?: boolean }) => {
          ;(globalThis as { __orderCalls?: typeof orderCalls }).__orderCalls?.push({
            column,
            ascending: opts?.ascending,
          })
          return builder
        }
        builder.range = (from: number) => {
          // Determine which page `from` lands on (pages are 1000 wide).
          const pageIndex = Math.floor(from / 1000)
          const count = PAGES[pageIndex] ?? 0
          const start = PAGES.slice(0, pageIndex).reduce((a, b) => a + b, 0)
          const data = Array.from({ length: count }, (_, i) => makeDbRow(start + i))
          return Promise.resolve({ data, error: null })
        }
        return builder
      },
    }),
  }
})

describe('listJobs pagination (>1000 rows)', () => {
  beforeEach(() => {
    orderCalls.length = 0
    ;(globalThis as { __orderCalls?: typeof orderCalls }).__orderCalls = orderCalls
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('stitches 1000 + 1000 + 37 into 2037 rows in stable append order', async () => {
    const { listJobs } = await import('@/lib/data/pg/queries')
    const rows = await listJobs()
    expect(rows).toHaveLength(2037)
    // Stable order: the ids ascend in append order across page boundaries.
    expect(rows[0].name).toBe('Job 0')
    expect(rows[999].name).toBe('Job 999')
    expect(rows[1000].name).toBe('Job 1000')
    expect(rows[2036].name).toBe('Job 2036')
    // rowNumber is synthetic (index + 2).
    expect(rows[0].rowNumber).toBe(2)
    expect(rows[2036].rowNumber).toBe(2038)
  })

  it('requests a stable order (submitted_at asc, id asc tiebreak)', async () => {
    const { listJobs } = await import('@/lib/data/pg/queries')
    await listJobs()
    // Each page sends both order params; assert the first page's pair.
    expect(orderCalls.slice(0, 2)).toEqual([
      { column: 'submitted_at', ascending: true },
      { column: 'id', ascending: true },
    ])
  })
})
