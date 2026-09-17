import { beforeEach, describe, expect, it, vi } from 'vitest'

// lib/mcp/tools.ts: the tools Claude gets over /api/mcp. The data layer and
// the mutation core are mocked; what is pinned is that each tool calls the
// right primitive with the right arguments, shapes its answer compactly,
// passes the caller's actor through on writes, and hands the mutation core's
// refusals back unchanged (the state machine is the admin site's, not ours).

const data = vi.hoisted(() => ({
  addJobNote: vi.fn(),
  findCustomerByEmail: vi.fn(),
  findRowByJobId: vi.fn(),
  getAppointmentByJobId: vi.fn(),
  getCustomerById: vi.fn(),
  listActivitiesForJob: vi.fn(),
  listAppointmentsInRange: vi.fn(),
  listCustomers: vi.fn(),
  listJobs: vi.fn(),
  NEEDS_TRIAGE_STATUSES: new Set(['New']),
  QUOTED_STATUSES: new Set(['Quoted', 'Pending Follow-Up']),
}))
vi.mock('@/lib/data', () => data)
const mutations = vi.hoisted(() => ({ createCustomer: vi.fn(), moveJobStatus: vi.fn() }))
vi.mock('@/lib/crm/mutations', () => mutations)
const payments = vi.hoisted(() => ({ listPaymentsSince: vi.fn() }))
vi.mock('@/lib/data/pg/payments', () => payments)
vi.mock('@/lib/data/backend', () => ({ getBackend: () => 'postgres' }))
vi.mock('@/lib/security/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  actorFor,
  addNote,
  businessSnapshot,
  compactJob,
  customerHistory,
  findCustomer,
  getJob,
  listJobsTool,
  logPhoneJob,
  moveJob,
  todaySchedule,
  TOOLS,
} from '@/lib/mcp/tools'
import type { ContactRow } from '@/lib/data'

const ACTOR = 'claude:mom'
const JOB = '11111111-2222-4333-8444-555555555555'
const CUST = '22222222-2222-4333-8444-555555555555'

function row(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    submitted_at: '2026-09-16T14:00:00.000Z',
    name: 'Sarah Kim',
    phone: '+19195550142',
    email: 'sarah@example.com',
    address: '412 Oak St, Garner, NC',
    service_type: 'mounting',
    preferred_date: '',
    description: 'Two TVs mounted',
    referral_source: 'Neighbor',
    status: 'New',
    job_id: JOB,
    balance_owed_cents: '35000',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  data.listJobs.mockResolvedValue([])
  data.listCustomers.mockResolvedValue([])
  data.listActivitiesForJob.mockResolvedValue([])
  data.getAppointmentByJobId.mockResolvedValue(null)
  data.listAppointmentsInRange.mockResolvedValue([])
  payments.listPaymentsSince.mockResolvedValue([])
})

describe('registry', () => {
  it('exposes the nine tools and nothing that moves money', () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      'find_customer',
      'customer_history',
      'list_jobs',
      'get_job',
      'today_schedule',
      'log_phone_job',
      'move_job',
      'add_note',
      'business_snapshot',
    ])
    expect(TOOLS.filter((t) => !t.readOnly).map((t) => t.name)).toEqual(['log_phone_job', 'move_job', 'add_note'])
  })

  it('derives the actor from the token label', () => {
    expect(actorFor('mom')).toBe('claude:mom')
  })

  it('compacts a job to the fields a phone conversation needs', () => {
    expect(compactJob(row({ dispatch_status: 'Dispatched' }))).toMatchObject({
      jobId: JOB,
      name: 'Sarah Kim',
      status: 'New',
      service: 'mounting',
      dispatch: 'Dispatched',
      balanceOwedCents: 35000,
      depositPaidCents: 0,
    })
  })
})

describe('find_customer', () => {
  it('looks up by email through the unique key', async () => {
    data.findCustomerByEmail.mockResolvedValue({ id: CUST })
    data.getCustomerById.mockResolvedValue({
      id: CUST, name: 'Sarah Kim', phone: '+19195550142', email: 'sarah@example.com', notes: '', jobCount: '2', lastJobAt: '2026-09-01', firstJobAt: '', depositsCollectedCents: '0', propertyCount: '1', anonymized: false, jobs: [], properties: [],
    })
    const res = await findCustomer.run({ query: 'Sarah@Example.com' }, ACTOR)
    expect(data.findCustomerByEmail).toHaveBeenCalledWith('sarah@example.com')
    expect(res).toEqual({ matches: [expect.objectContaining({ id: CUST, name: 'Sarah Kim', jobCount: '2' })] })
  })

  it('matches by phone digits or name fragment and skips anonymized customers', async () => {
    data.listCustomers.mockResolvedValue([
      { id: '1', name: 'Sarah Kim', phone: '+19195550142', email: 'a@x.com', notes: '', jobCount: '1', lastJobAt: '', anonymized: false },
      { id: '2', name: 'Kim Jones', phone: '+19195559999', email: 'b@x.com', notes: '', jobCount: '1', lastJobAt: '', anonymized: false },
      { id: '3', name: '[REDACTED]', phone: '', email: 'redacted:x', notes: '', jobCount: '1', lastJobAt: '', anonymized: true },
    ])
    expect((await findCustomer.run({ query: '919-555-0142' }, ACTOR)) as { matches: unknown[] }).toMatchObject({ matches: [{ id: '1' }] })
    const byName = (await findCustomer.run({ query: 'kim' }, ACTOR)) as { matches: { id: string }[] }
    expect(byName.matches.map((m) => m.id)).toEqual(['1', '2'])
  })
})

describe('customer_history', () => {
  it('returns the customer, properties and compact jobs', async () => {
    data.getCustomerById.mockResolvedValue({
      id: CUST, name: 'Sarah Kim', phone: '', email: 'sarah@example.com', notes: 'gate code 1234', jobCount: '1', lastJobAt: '', firstJobAt: '', depositsCollectedCents: '0', propertyCount: '1', anonymized: false,
      jobs: [{ ...row(), rowNumber: 2 }], properties: [{ address: '412 Oak St', jobCount: '1', lastJobAt: '' }],
    })
    const res = (await customerHistory.run({ customerId: CUST }, ACTOR)) as { found: boolean; jobs: unknown[] }
    expect(res.found).toBe(true)
    expect(res.jobs).toEqual([expect.objectContaining({ jobId: JOB })])
    data.getCustomerById.mockResolvedValue(null)
    expect(await customerHistory.run({ customerId: CUST }, ACTOR)).toEqual({ found: false })
  })
})

describe('list_jobs', () => {
  it('filters by status, triage and open quotes, newest first', async () => {
    data.listJobs.mockResolvedValue([
      { ...row({ job_id: 'a', status: 'New', submitted_at: '2026-09-10T00:00:00.000Z' }), rowNumber: 1 },
      { ...row({ job_id: 'b', status: 'New', dispatch_status: 'Dispatched', submitted_at: '2026-09-12T00:00:00.000Z' }), rowNumber: 2 },
      { ...row({ job_id: 'c', status: 'Quoted', submitted_at: '2026-09-11T00:00:00.000Z' }), rowNumber: 3 },
    ])
    const all = (await listJobsTool.run({ limit: 30 }, ACTOR)) as { total: number; jobs: { jobId: string }[] }
    expect(all.total).toBe(3)
    expect(all.jobs.map((j) => j.jobId)).toEqual(['b', 'c', 'a'])
    const triage = (await listJobsTool.run({ needsTriage: true, limit: 30 }, ACTOR)) as { jobs: { jobId: string }[] }
    expect(triage.jobs.map((j) => j.jobId)).toEqual(['a'])
    const quotes = (await listJobsTool.run({ openQuotes: true, limit: 30 }, ACTOR)) as { jobs: { jobId: string }[] }
    expect(quotes.jobs.map((j) => j.jobId)).toEqual(['c'])
    const limited = (await listJobsTool.run({ limit: 1 }, ACTOR)) as { total: number; jobs: unknown[] }
    expect(limited.total).toBe(3)
    expect(limited.jobs).toHaveLength(1)
  })
})

describe('get_job', () => {
  it('returns the job with appointment and timeline', async () => {
    data.findRowByJobId.mockResolvedValue({ rowNumber: 2, row: row() })
    data.getAppointmentByJobId.mockResolvedValue({ startsAt: 's', endsAt: 'e', status: 'scheduled' })
    data.listActivitiesForJob.mockResolvedValue([{ at: 't', actor: 'claude:mom', action: 'note.added', notes: 'gate 1234', before: '', after: '' }])
    const res = (await getJob.run({ jobId: JOB }, ACTOR)) as { found: boolean; appointment: unknown; activities: unknown[] }
    expect(res.found).toBe(true)
    expect(res.appointment).toEqual({ startsAt: 's', endsAt: 'e', status: 'scheduled' })
    expect(res.activities).toEqual([expect.objectContaining({ action: 'note.added', notes: 'gate 1234' })])
    data.findRowByJobId.mockResolvedValue(null)
    expect(await getJob.run({ jobId: JOB }, ACTOR)).toEqual({ found: false })
  })
})

describe('today_schedule', () => {
  it('keeps appointments whose Eastern date matches and lists booked jobs without one', async () => {
    data.listAppointmentsInRange.mockResolvedValue([
      { id: '1', jobId: JOB, startsAt: '2026-09-20T13:00:00.000Z', endsAt: '2026-09-20T15:00:00.000Z', status: 'scheduled' },
      { id: '2', jobId: 'x', startsAt: '2026-09-21T13:00:00.000Z', endsAt: '2026-09-21T15:00:00.000Z', status: 'scheduled' },
      { id: '3', jobId: 'y', startsAt: '2026-09-20T16:00:00.000Z', endsAt: '2026-09-20T17:00:00.000Z', status: 'cancelled' },
    ])
    data.listJobs.mockResolvedValue([
      { ...row({ status: 'Booked' }), rowNumber: 1 },
      { ...row({ job_id: 'z', status: 'Booked', preferred_date: '2026-09-20' }), rowNumber: 2 },
    ])
    const res = (await todaySchedule.run({ date: '2026-09-20' }, ACTOR)) as {
      date: string
      scheduled: { job: { jobId: string } }[]
      alsoOnTheBoard: { jobId: string }[]
    }
    expect(res.date).toBe('2026-09-20')
    expect(res.scheduled.map((s) => s.job.jobId)).toEqual([JOB])
    expect(res.alsoOnTheBoard.map((j) => j.jobId)).toEqual(['z'])
  })
})

describe('log_phone_job', () => {
  it('creates the customer and a New job through the mutation core with the actor', async () => {
    mutations.createCustomer.mockResolvedValue({ ok: true, customerId: CUST, jobId: JOB, message: 'Customer added with a new deal in the pipeline.' })
    const res = await logPhoneJob.run(
      {
        name: 'Sarah Kim',
        phone: '919 555 0142',
        address: '412 Oak St, Garner',
        serviceType: 'TV mounting',
        description: 'Two TVs and a leaky faucet',
        urgency: 'asap',
        referralSource: 'her neighbor Dave',
      },
      ACTOR,
    )
    expect(mutations.createCustomer).toHaveBeenCalledWith({
      profile: { name: 'Sarah Kim', phone: '919 555 0142', email: undefined },
      initialDeal: {
        serviceType: 'TV mounting',
        address: '412 Oak St, Garner',
        description: 'Phone job. Two TVs and a leaky faucet\n\nReferred by: her neighbor Dave',
        urgency: 'asap',
        preferredDate: undefined,
      },
      actor: ACTOR,
    })
    expect(res).toEqual({ ok: true, customerId: CUST, jobId: JOB, message: 'Customer added with a new deal in the pipeline.', dispatched: false })
  })

  it('hands back a validation refusal unchanged', async () => {
    mutations.createCustomer.mockResolvedValue({ ok: false, error: 'That phone number doesn’t look valid.' })
    const res = await logPhoneJob.run({ name: 'X', phone: '1', serviceType: 's', description: 'd' }, ACTOR)
    expect(res).toEqual({ ok: false, error: 'That phone number doesn’t look valid.', duplicate: undefined })
  })
})

describe('move_job', () => {
  it('delegates to moveJobStatus with the actor and returns its answer as is', async () => {
    mutations.moveJobStatus.mockResolvedValue({ ok: false, error: 'Use “Mark Complete” on the job to complete it — it charges the saved-card balance.' })
    const res = await moveJob.run({ jobId: JOB, newStatus: 'Complete' }, ACTOR)
    expect(mutations.moveJobStatus).toHaveBeenCalledWith({ jobId: JOB, newStatus: 'Complete', actor: ACTOR })
    expect(res).toEqual({ ok: false, error: 'Use “Mark Complete” on the job to complete it — it charges the saved-card balance.' })
  })

  it('rejects a status outside the closed set at the schema', () => {
    expect(moveJob.inputSchema.safeParse({ jobId: JOB, newStatus: 'Done' }).success).toBe(false)
  })
})

describe('add_note', () => {
  it('writes the note under the actor', async () => {
    data.addJobNote.mockResolvedValue({ ok: true })
    expect(await addNote.run({ jobId: JOB, text: '  prefers texts after 5  ' }, ACTOR)).toEqual({ ok: true })
    expect(data.addJobNote).toHaveBeenCalledWith(JOB, ACTOR, 'prefers texts after 5')
    data.addJobNote.mockResolvedValue({ ok: false })
    expect(await addNote.run({ jobId: JOB, text: 'x' }, ACTOR)).toMatchObject({ ok: false })
  })
})

describe('business_snapshot', () => {
  it('counts the board and reads revenue from the ledger', async () => {
    data.listJobs.mockResolvedValue([
      { ...row({ job_id: 'a', status: 'New' }), rowNumber: 1 },
      { ...row({ job_id: 'b', status: 'Quoted' }), rowNumber: 2 },
      { ...row({ job_id: 'c', status: 'Complete', balance_owed_cents: '1200' }), rowNumber: 3 },
    ])
    payments.listPaymentsSince.mockResolvedValue([
      { purpose: 'deposit', status: 'succeeded', amountCents: 15000, createdAt: new Date().toISOString() },
    ])
    const res = (await businessSnapshot.run({}, ACTOR)) as Record<string, unknown>
    expect(res.totalJobs).toBe(3)
    expect(res.byStatus).toEqual({ New: 1, Quoted: 1, Complete: 1 })
    expect(res.needsTriage).toBe(1)
    expect(res.openQuotes).toBe(1)
    expect(res.balanceOwedAfterCompleteCents).toBe(1200)
    expect(res.revenueThisMonthCents).toBe(15000)
    expect(payments.listPaymentsSince).toHaveBeenCalled()
  })
})
