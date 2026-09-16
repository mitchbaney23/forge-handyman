import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// lib/twenty/sync.ts: the one-way booking-form-to-Twenty push. Contract:
// forge-platform businesses/forge-handyman/SYNC.md. These tests pin:
//  - the pure field mapping (status/category/urgency/property maps, the name
//    split, the job name, cents to micros, E.164 to Twenty's phone composite);
//  - off-by-default: no env means no fetch, ever;
//  - the upsert order and keys: person by email (PATCH phone only when it
//    exists, never the name), then job by websiteJobId, POST when absent and
//    PATCH when present, customerId set on the job;
//  - sentinel emails sync the job without a person;
//  - nothing throws past the module: a dead Twenty returns ok:false and lands
//    in Sentry.

const sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@sentry/nextjs', () => sentry)
vi.mock('@/lib/security/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string | undefined) => (e ? 'masked' : ''),
}))
const data = vi.hoisted(() => ({
  findRowByJobId: vi.fn(),
  getAppointmentByJobId: vi.fn(),
}))
vi.mock('@/lib/data', () => data)

import {
  buildJobFields,
  buildPersonFields,
  centsToCurrency,
  getTwentyConfig,
  isSentinelEmail,
  jobName,
  mapCategories,
  redactInTwenty,
  splitName,
  splitPhone,
  syncJobById,
  syncJobToTwenty,
  syncQuoteToTwenty,
} from '@/lib/twenty/sync'
import type { ContactRow } from '@/lib/data'

const JOB_ID = '11111111-2222-4333-8444-555555555555'

function row(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    submitted_at: '2026-09-16T14:00:00.000Z',
    name: 'Sarah Kim',
    phone: '+19195550142',
    email: 'Sarah@Example.com',
    address: '412 Oak St, Garner, NC 27529',
    service_type: 'mounting',
    preferred_date: '',
    description: 'Two TVs mounted',
    referral_source: 'Neighbor',
    status: 'New',
    job_id: JOB_ID,
    service_categories: 'mounting',
    property_type: 'residential',
    urgency: 'asap',
    photo_urls: 'https://drive.example/1.jpg,https://drive.example/2.jpg',
    ...overrides,
  }
}

type Call = { method: string; url: string; body: unknown }
const calls: Call[] = []
// Each queued entry answers the next fetch, in order.
let responses: Array<{ status?: number; json: unknown }> = []

function queue(...items: Array<{ status?: number; json: unknown }>) {
  responses.push(...items)
}

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  calls.push({
    method: init?.method ?? 'GET',
    url,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  })
  const next = responses.shift()
  if (!next) throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`)
  return {
    ok: (next.status ?? 200) < 400,
    status: next.status ?? 200,
    text: async () => JSON.stringify(next.json),
  }
})

beforeEach(() => {
  calls.length = 0
  responses = []
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  process.env.TWENTY_API_URL = 'https://bellowscrm.com/rest'
  process.env.TWENTY_API_KEY = 'test-key'
  delete process.env.TWENTY_SYNC_DISABLED
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.TWENTY_API_URL
  delete process.env.TWENTY_API_KEY
  delete process.env.TWENTY_SYNC_DISABLED
})

const EMPTY = { json: { data: { people: [], workOrders: [], quotes: [] } } }

describe('mapping', () => {
  it('splits a name on the last space and keeps a single word as the first name', () => {
    expect(splitName('Sarah Kim')).toEqual({ firstName: 'Sarah', lastName: 'Kim' })
    expect(splitName('Mary Ann  Van Buren')).toEqual({ firstName: 'Mary Ann Van', lastName: 'Buren' })
    expect(splitName('Cher')).toEqual({ firstName: 'Cher', lastName: '' })
  })

  it('names the job from the service and the last name, with a description fallback', () => {
    expect(jobName(row())).toBe('Mounting & assembly - Kim')
    expect(jobName(row({ service_type: 'The Honey-Do', service_categories: 'mounting,plumbing' }))).toBe('The Honey-Do - Kim')
    expect(jobName(row({ service_type: 'multiple', service_categories: 'mounting,plumbing' }))).toBe('Multiple things - Kim')
    expect(
      jobName(row({ service_type: 'other', service_categories: '', description: 'Fix the squeaky gate latch and paint it', name: 'Cher' })),
    ).toBe('Fix the squeaky gate latch and paint it')
    expect(jobName(row({ service_type: 'other', service_categories: '', description: '' }))).toBe('Job - Kim')
  })

  it('maps categories, and the custom path becomes OTHER', () => {
    expect(mapCategories({ service_categories: 'mounting, plumbing', service_type: 'multiple' })).toEqual(['MOUNTING', 'PLUMBING'])
    expect(mapCategories({ service_categories: '', service_type: 'other' })).toEqual(['OTHER'])
    expect(mapCategories({ service_categories: 'not_a_code', service_type: 'The Honey-Do' })).toEqual([])
  })

  it('converts cents to micros and ignores blanks', () => {
    expect(centsToCurrency('12345')).toEqual({ amountMicros: 123_450_000, currencyCode: 'USD' })
    expect(centsToCurrency('')).toBeUndefined()
    expect(centsToCurrency(undefined)).toBeUndefined()
    expect(centsToCurrency('abc')).toBeUndefined()
  })

  it('splits an E.164 phone into Twenty\'s composite', () => {
    expect(splitPhone('+19195550142')).toEqual({
      primaryPhoneNumber: '9195550142',
      primaryPhoneCountryCode: 'US',
      primaryPhoneCallingCode: '+1',
    })
    expect(splitPhone('')).toBeNull()
  })

  it('recognises anonymization sentinels', () => {
    expect(isSentinelEmail('redacted:abc')).toBe(true)
    expect(isSentinelEmail('unknown:abc')).toBe(true)
    expect(isSentinelEmail('sarah@example.com')).toBe(false)
  })

  it('builds only the contracted job fields', () => {
    const fields = buildJobFields(
      row({
        status: 'Booked',
        deposit_paid_cents: '15000',
        balance_owed_cents: '35000',
        complete_date: '2026-09-20T18:30:00.000Z',
      }),
      { startsAt: '2026-09-20T13:00:00.000Z', endsAt: '2026-09-20T15:00:00.000Z' },
    )
    expect(fields).toEqual({
      websiteJobId: JOB_ID,
      name: 'Mounting & assembly - Kim',
      source: 'BOOKING_FORM',
      serviceCategories: ['MOUNTING'],
      jobAddress: '412 Oak St, Garner, NC 27529',
      description: 'Two TVs mounted',
      referralSource: 'Neighbor',
      status: 'BOOKED',
      propertyType: 'RESIDENTIAL',
      urgency: 'ASAP',
      scheduledStart: '2026-09-20T13:00:00.000Z',
      scheduledEnd: '2026-09-20T15:00:00.000Z',
      completedDate: '2026-09-20',
      depositPaid: { amountMicros: 150_000_000, currencyCode: 'USD' },
      balanceOwed: { amountMicros: 350_000_000, currencyCode: 'USD' },
      photosLink: { primaryLinkUrl: 'https://drive.example/1.jpg', primaryLinkLabel: 'Photos' },
    })
    // Fields Twenty owns are never in the payload.
    expect(fields).not.toHaveProperty('workOrderNotes')
    expect(fields).not.toHaveProperty('technician')
  })

  it('leaves an unknown status out rather than guessing', () => {
    expect(buildJobFields(row({ status: 'Something Odd' }))).not.toHaveProperty('status')
  })

  it('lowercases the email on the person', () => {
    expect(buildPersonFields(row())).toEqual({
      name: { firstName: 'Sarah', lastName: 'Kim' },
      emails: { primaryEmail: 'sarah@example.com' },
      phones: { primaryPhoneNumber: '9195550142', primaryPhoneCountryCode: 'US', primaryPhoneCallingCode: '+1' },
    })
  })
})

describe('configuration', () => {
  it('is off without env and off with the kill switch', async () => {
    delete process.env.TWENTY_API_KEY
    expect(getTwentyConfig()).toBeNull()
    expect(await syncJobToTwenty(row())).toEqual({ ok: false, skipped: 'disabled' })
    process.env.TWENTY_API_KEY = 'k'
    process.env.TWENTY_SYNC_DISABLED = 'true'
    expect(await syncJobToTwenty(row())).toEqual({ ok: false, skipped: 'disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the base URL with or without /rest', () => {
    process.env.TWENTY_API_URL = 'https://bellowscrm.com/'
    expect(getTwentyConfig()?.restUrl).toBe('https://bellowscrm.com/rest')
    process.env.TWENTY_API_URL = 'https://bellowscrm.com/rest'
    expect(getTwentyConfig()?.restUrl).toBe('https://bellowscrm.com/rest')
  })
})

describe('syncJobToTwenty', () => {
  it('creates the person then the job, linked, when neither exists', async () => {
    queue(EMPTY, { json: { data: { createPerson: { id: 'p1' } } } }, EMPTY, { json: { data: { createWorkOrder: { id: 'w1' } } } })

    const res = await syncJobToTwenty(row())

    expect(res).toEqual({ ok: true, twentyJobId: 'w1', twentyPersonId: 'p1', created: true })
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://bellowscrm.com/rest/people?filter=emails.primaryEmail%5Beq%5D%3A%22sarah%40example.com%22&limit=1',
      'POST https://bellowscrm.com/rest/people',
      `GET https://bellowscrm.com/rest/workOrders?filter=websiteJobId%5Beq%5D%3A%22${JOB_ID}%22&limit=1`,
      'POST https://bellowscrm.com/rest/workOrders',
    ])
    expect(calls[1].body).toEqual(buildPersonFields(row()))
    expect(calls[3].body).toMatchObject({ websiteJobId: JOB_ID, status: 'NEW', customerId: 'p1' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
  })

  it('updates in place when both exist, refreshing only the phone on the person', async () => {
    queue(
      { json: { data: { people: [{ id: 'p1' }] } } },
      { json: { data: { updatePerson: { id: 'p1' } } } },
      { json: { data: { workOrders: [{ id: 'w1' }] } } },
      { json: { data: { updateWorkOrder: { id: 'w1' } } } },
    )

    const res = await syncJobToTwenty(row({ status: 'Quoted' }))

    expect(res).toEqual({ ok: true, twentyJobId: 'w1', twentyPersonId: 'p1', created: false })
    expect(calls[1]).toMatchObject({ method: 'PATCH', url: 'https://bellowscrm.com/rest/people/p1' })
    expect(calls[1].body).toEqual({ phones: splitPhone('+19195550142') })
    expect(calls[1].body).not.toHaveProperty('name')
    expect(calls[3]).toMatchObject({ method: 'PATCH', url: 'https://bellowscrm.com/rest/workOrders/w1' })
    expect(calls[3].body).toMatchObject({ status: 'QUOTED', customerId: 'p1' })
  })

  it('syncs a sentinel-email job with no person and no customer link', async () => {
    queue(EMPTY, { json: { data: { createWorkOrder: { id: 'w1' } } } })

    const res = await syncJobToTwenty(row({ email: 'redacted:abc' }))

    expect(res).toEqual({ ok: true, twentyJobId: 'w1', twentyPersonId: null, created: true })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST'])
    expect(calls[1].body).not.toHaveProperty('customerId')
  })

  it('skips a row with no job id', async () => {
    expect(await syncJobToTwenty(row({ job_id: '' }))).toEqual({ ok: false, skipped: 'no-job-id' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never throws: an HTTP failure is reported to Sentry and returned', async () => {
    queue({ status: 500, json: { error: 'boom' } })

    const res = await syncJobToTwenty(row())

    expect(res.ok).toBe(false)
    expect('error' in res && res.error).toMatch(/HTTP 500/)
    expect(sentry.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: { feature: 'twenty-sync', step: 'person' } }),
    )
  })

  it('never throws: a network failure is reported and returned', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))

    const res = await syncJobToTwenty(row())

    expect(res).toEqual({ ok: false, error: 'ECONNREFUSED' })
    expect(sentry.captureException).toHaveBeenCalled()
  })
})

describe('syncJobById', () => {
  it('does not touch the data layer when the sync is off', async () => {
    delete process.env.TWENTY_API_KEY
    expect(await syncJobById(JOB_ID)).toEqual({ ok: false, skipped: 'disabled' })
    expect(data.findRowByJobId).not.toHaveBeenCalled()
  })

  it('reads the row and its appointment, then syncs with the schedule', async () => {
    data.findRowByJobId.mockResolvedValue({ rowNumber: 2, row: row({ status: 'Booked' }) })
    data.getAppointmentByJobId.mockResolvedValue({
      startsAt: '2026-09-20T13:00:00.000Z',
      endsAt: '2026-09-20T15:00:00.000Z',
      status: 'scheduled',
    })
    queue(
      { json: { data: { people: [{ id: 'p1' }] } } },
      { json: { data: { updatePerson: { id: 'p1' } } } },
      { json: { data: { workOrders: [{ id: 'w1' }] } } },
      { json: { data: { updateWorkOrder: { id: 'w1' } } } },
    )

    const res = await syncJobById(JOB_ID)

    expect(res.ok).toBe(true)
    expect(calls[3].body).toMatchObject({
      status: 'BOOKED',
      scheduledStart: '2026-09-20T13:00:00.000Z',
      scheduledEnd: '2026-09-20T15:00:00.000Z',
    })
  })

  it('reports an unknown job without calling Twenty', async () => {
    data.findRowByJobId.mockResolvedValue(null)
    expect(await syncJobById(JOB_ID)).toEqual({ ok: false, skipped: 'not-found' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('syncQuoteToTwenty', () => {
  it('creates a SENT quote on the job and stamps quoteTotal', async () => {
    data.findRowByJobId.mockResolvedValue({ rowNumber: 2, row: row() })
    queue(
      { json: { data: { workOrders: [{ id: 'w1' }] } } },
      EMPTY,
      { json: { data: { createQuote: { id: 'q1' } } } },
      { json: { data: { updateWorkOrder: { id: 'w1' } } } },
    )

    const res = await syncQuoteToTwenty({
      jobId: JOB_ID,
      depositCents: 15000,
      balanceCents: 35000,
      paymentLinkUrl: 'https://buy.stripe.com/abc',
      sentAt: '2026-09-16T15:00:00.000Z',
    })

    expect(res).toEqual({ ok: true, twentyQuoteId: 'q1', created: true })
    expect(calls[2]).toMatchObject({ method: 'POST', url: 'https://bellowscrm.com/rest/quotes' })
    expect(calls[2].body).toEqual({
      workOrderId: 'w1',
      status: 'SENT',
      deposit: { amountMicros: 150_000_000, currencyCode: 'USD' },
      balanceDue: { amountMicros: 350_000_000, currencyCode: 'USD' },
      total: { amountMicros: 500_000_000, currencyCode: 'USD' },
      sentDate: '2026-09-16',
      paymentLink: { primaryLinkUrl: 'https://buy.stripe.com/abc', primaryLinkLabel: 'Pay deposit' },
      name: 'Quote - Mounting & assembly - Kim',
    })
    expect(calls[3]).toMatchObject({ method: 'PATCH', url: 'https://bellowscrm.com/rest/workOrders/w1' })
    expect(calls[3].body).toEqual({ quoteTotal: { amountMicros: 500_000_000, currencyCode: 'USD' } })
  })
})

describe('redactInTwenty', () => {
  it('strips PII from each synced job and the person, keeping the records', async () => {
    queue(
      { json: { data: { workOrders: [{ id: 'w1' }] } } },
      { json: { data: { updateWorkOrder: { id: 'w1' } } } },
      { json: { data: { people: [{ id: 'p1' }] } } },
      { json: { data: { updatePerson: { id: 'p1' } } } },
    )

    const res = await redactInTwenty({ email: 'sarah@example.com', jobIds: [JOB_ID] })

    expect(res).toEqual({ ok: true, jobsRedacted: 1, personRedacted: true })
    expect(calls[1].body).toMatchObject({ name: '[REDACTED]', jobAddress: '[REDACTED]', description: '[REDACTED]', customerId: null })
    expect(calls[3].body).toMatchObject({
      name: { firstName: '[REDACTED]', lastName: '' },
      emails: { primaryEmail: 'redacted-p1@redacted.invalid', additionalEmails: [] },
    })
  })

  it('reports a partial failure instead of throwing', async () => {
    queue({ json: { data: { workOrders: [{ id: 'w1' }] } } }, { status: 502, json: {} })

    const res = await redactInTwenty({ email: 'sarah@example.com', jobIds: [JOB_ID] })

    expect(res.ok).toBe(false)
    expect(res.jobsRedacted).toBe(0)
    expect(sentry.captureException).toHaveBeenCalled()
  })
})
