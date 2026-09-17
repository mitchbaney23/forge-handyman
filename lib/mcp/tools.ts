import { z } from 'zod'
import { createCustomer, moveJobStatus } from '@/lib/crm/mutations'
import {
  addJobNote,
  findCustomerByEmail,
  findRowByJobId,
  getAppointmentByJobId,
  getCustomerById,
  listActivitiesForJob,
  listAppointmentsInRange,
  listCustomers,
  listJobs,
  NEEDS_TRIAGE_STATUSES,
  QUOTED_STATUSES,
  type ContactRow,
  type JobRow,
} from '@/lib/data'
import { getBackend } from '@/lib/data/backend'
import { listPaymentsSince } from '@/lib/data/pg/payments'
import { claudeActor } from '@/lib/data/activity-actions'
import { revenueThisMonthCents, topLeadSources } from '@/lib/admin/metrics'
import { easternIsoDate } from '@/lib/scheduling/time'

// ---------------------------------------------------------------------------
// The tools Claude gets over /api/mcp. Each is a plain async function over the
// data layer and the shared mutation core (lib/crm/mutations.ts), so the same
// guardrails the admin UI has apply: the status state machine, the shared
// input schemas, and activity logging under the caller's actor
// (`claude:<label>`, from the bearer token).
//
// Deliberately absent: sending a quote, charging, refunding, cancelling an
// appointment, anonymizing. Money and customer-facing sends stay in /admin.
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  'New',
  'Quoted',
  'Pending Follow-Up',
  'Booked',
  'In Progress',
  'Complete',
  'Cancelled',
  'Payment Failed',
  'Refunded',
  'Partial Refund',
] as const

const DAY_MS = 24 * 60 * 60 * 1000

export interface CompactJob {
  jobId: string
  name: string
  status: string
  service: string
  address: string
  submittedAt: string
  preferredDate: string
  phone: string
  email: string
  urgency: string
  dispatch: string
  depositPaidCents: number
  balanceOwedCents: number
}

export function compactJob(row: ContactRow): CompactJob {
  return {
    jobId: row.job_id || '',
    name: row.name,
    status: row.status,
    service: row.service_type,
    address: row.address,
    submittedAt: row.submitted_at,
    preferredDate: row.preferred_date,
    phone: row.phone,
    email: row.email,
    urgency: row.urgency || '',
    dispatch: row.dispatch_status || '',
    depositPaidCents: Number(row.deposit_paid_cents || '0') || 0,
    balanceOwedCents: Number(row.balance_owed_cents || '0') || 0,
  }
}

function digits(s: string): string {
  return (s || '').replace(/\D/g, '')
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export interface ToolDefinition<Input> {
  name: string
  title: string
  description: string
  inputSchema: z.ZodType<Input>
  readOnly: boolean
  run: (input: Input, actor: string) => Promise<unknown>
}

function define<Input>(def: ToolDefinition<Input>): ToolDefinition<Input> {
  return def
}

export const findCustomer = define({
  name: 'find_customer',
  title: 'Find a customer',
  description:
    'Look up customers by email, phone, or part of a name. Returns up to 10 matches with their id, contact details, job count and last job date. Use the id with customer_history.',
  inputSchema: z.object({
    query: z.string().min(2).max(120).describe('An email, a phone number, or part of a name'),
  }),
  readOnly: true,
  run: async ({ query }) => {
    const q = query.trim()
    if (q.includes('@')) {
      const found = await findCustomerByEmail(q.toLowerCase())
      if (!found) return { matches: [] }
      const detail = await getCustomerById(found.id)
      return { matches: detail ? [summaryOf(detail)] : [{ id: found.id, email: q.toLowerCase() }] }
    }
    const all = await listCustomers()
    const qDigits = digits(q)
    const qLower = q.toLowerCase()
    const matches = all
      .filter((c) => {
        if (c.anonymized) return false
        if (qDigits.length >= 7 && digits(c.phone).includes(qDigits)) return true
        return c.name.toLowerCase().includes(qLower)
      })
      .slice(0, 10)
      .map(summaryOf)
    return { matches }
  },
})

function summaryOf(c: {
  id: string
  name: string
  phone: string
  email: string
  jobCount: string
  lastJobAt: string
  notes: string
}) {
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, jobCount: c.jobCount, lastJobAt: c.lastJobAt, notes: c.notes }
}

export const customerHistory = define({
  name: 'customer_history',
  title: 'Customer history',
  description: 'Everything about one customer: contact details, notes, their properties, and every job with status and money.',
  inputSchema: z.object({ customerId: z.string().uuid() }),
  readOnly: true,
  run: async ({ customerId }) => {
    const detail = await getCustomerById(customerId)
    if (!detail) return { found: false }
    return {
      found: true,
      customer: summaryOf(detail),
      properties: detail.properties,
      jobs: detail.jobs.map(compactJob),
    }
  },
})

export const listJobsTool = define({
  name: 'list_jobs',
  title: 'List jobs',
  description:
    'Jobs on the board, newest first. Filter by status, or ask for needsTriage (New jobs with no dispatch decision yet), or openQuotes (Quoted and Pending Follow-Up).',
  inputSchema: z.object({
    status: z.enum(JOB_STATUSES).optional(),
    needsTriage: z.boolean().optional(),
    openQuotes: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(30),
  }),
  readOnly: true,
  run: async ({ status, needsTriage, openQuotes, limit }) => {
    const jobs = await listJobs()
    const filtered = jobs
      .filter((j) => (status ? j.status === status : true))
      .filter((j) => (needsTriage ? NEEDS_TRIAGE_STATUSES.has(j.status) && !(j.dispatch_status || '').trim() : true))
      .filter((j) => (openQuotes ? QUOTED_STATUSES.has(j.status) : true))
      .sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1))
    return { total: filtered.length, jobs: filtered.slice(0, limit).map(compactJob) }
  },
})

export const getJob = define({
  name: 'get_job',
  title: 'Get a job',
  description: 'One job in full: the row, its appointment if booked, and the activity timeline (notes, status changes, dispatch decisions, payments).',
  inputSchema: z.object({ jobId: z.string().uuid() }),
  readOnly: true,
  run: async ({ jobId }) => {
    const found = await findRowByJobId(jobId)
    if (!found) return { found: false }
    const [activities, appointment] = await Promise.all([
      listActivitiesForJob(jobId),
      getAppointmentByJobId(jobId),
    ])
    return {
      found: true,
      job: { ...compactJob(found.row), description: found.row.description, referralSource: found.row.referral_source, photoUrls: found.row.photo_urls || '' },
      appointment: appointment
        ? { startsAt: appointment.startsAt, endsAt: appointment.endsAt, status: appointment.status }
        : null,
      activities: activities.map((a) => ({ at: a.at, actor: a.actor, action: a.action, notes: a.notes, before: a.before, after: a.after })),
    }
  },
})

export const todaySchedule = define({
  name: 'today_schedule',
  title: "Today's schedule",
  description: 'Booked appointments for a day (default today, Eastern time), plus jobs marked Booked or In Progress for that day without an appointment record.',
  inputSchema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, Eastern; defaults to today'),
  }),
  readOnly: true,
  run: async ({ date }) => {
    const day = date || easternIsoDate(new Date())
    const dayStart = new Date(`${day}T00:00:00Z`).getTime()
    // Appointments are stored as instants; widen the window by a day on each
    // side and keep the ones whose Eastern date matches.
    const appts = await listAppointmentsInRange(
      new Date(dayStart - DAY_MS).toISOString(),
      new Date(dayStart + 2 * DAY_MS).toISOString(),
    )
    const onDay = appts.filter((a) => a.status !== 'cancelled' && easternIsoDate(new Date(a.startsAt)) === day)
    const jobs = await listJobs()
    const byId = new Map(jobs.map((j) => [j.job_id, j] as const))
    const scheduled = onDay.map((a) => {
      const job = byId.get(a.jobId)
      return { startsAt: a.startsAt, endsAt: a.endsAt, job: job ? compactJob(job) : { jobId: a.jobId } }
    })
    const scheduledIds = new Set(onDay.map((a) => a.jobId))
    const unscheduled = jobs
      .filter((j) => (j.status === 'Booked' || j.status === 'In Progress') && j.preferred_date === day && !scheduledIds.has(j.job_id || ''))
      .map(compactJob)
    return { date: day, scheduled, alsoOnTheBoard: unscheduled }
  },
})

export const logPhoneJob = define({
  name: 'log_phone_job',
  title: 'Log a phone job',
  description:
    'Record a job that came in by phone, text or referral: creates the customer (or links an existing one by email) and a job at New. David is NOT notified by this; dispatch him from the admin site when the job is ready. Read the result back to the caller.',
  inputSchema: z.object({
    name: z.string().min(1).max(120),
    phone: z.string().max(40).optional(),
    email: z.string().max(160).optional(),
    address: z.string().max(300).optional(),
    serviceType: z.string().min(1).max(120).describe('Short description of the service, e.g. "TV mounting" or "Faucet repair"'),
    description: z.string().min(1).max(2000).describe('What the customer said, in their words'),
    urgency: z.enum(['asap', 'two_weeks', 'month', 'flexible']).optional(),
    referralSource: z.string().max(120).optional().describe('Who or what sent them, if they said'),
    preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  readOnly: false,
  run: async (input, actor) => {
    const lines = [`Phone job. ${input.description.trim()}`]
    if (input.referralSource?.trim()) lines.push(`Referred by: ${input.referralSource.trim()}`)
    const result = await createCustomer({
      profile: { name: input.name, phone: input.phone, email: input.email },
      initialDeal: {
        serviceType: input.serviceType,
        address: input.address,
        description: lines.join('\n\n'),
        urgency: input.urgency,
        preferredDate: input.preferredDate,
      },
      actor,
    })
    if (!result.ok) return { ok: false, error: result.error, duplicate: result.duplicate }
    return { ok: true, customerId: result.customerId, jobId: result.jobId, message: result.message, dispatched: false }
  },
})

export const moveJob = define({
  name: 'move_job',
  title: 'Move a job',
  description:
    'Change a job\'s status along the pipeline. The same rules as the admin site apply: Complete is never set here (completing charges the balance in the admin site), and payment states belong to Stripe. If a move is refused, tell the caller why in the message returned.',
  inputSchema: z.object({
    jobId: z.string().uuid(),
    newStatus: z.enum(JOB_STATUSES),
  }),
  readOnly: false,
  run: async ({ jobId, newStatus }, actor) => moveJobStatus({ jobId, newStatus, actor }),
})

export const addNote = define({
  name: 'add_note',
  title: 'Add a note to a job',
  description: 'Append a note to the job timeline: a callback promised, a gate code, a change of scope, what the customer said.',
  inputSchema: z.object({
    jobId: z.string().uuid(),
    text: z.string().min(1).max(2000),
  }),
  readOnly: false,
  run: async ({ jobId, text }, actor) => {
    const res = await addJobNote(jobId, actor, text.trim())
    return res.ok ? { ok: true } : { ok: false, error: 'Note not saved (unknown job, or notes are not available on this backend)' }
  },
})

export const businessSnapshot = define({
  name: 'business_snapshot',
  title: 'Business snapshot',
  description: 'Counts by status, jobs needing triage, open quotes, balances owed, revenue collected this month, and where the last 30 days of leads came from.',
  inputSchema: z.object({}),
  readOnly: true,
  run: async () => {
    const now = new Date()
    const jobs = await listJobs()
    const byStatus: Record<string, number> = {}
    let balanceOwedCents = 0
    for (const j of jobs) {
      byStatus[j.status] = (byStatus[j.status] || 0) + 1
      if (j.status === 'Complete') balanceOwedCents += Number(j.balance_owed_cents || '0') || 0
    }
    const needsTriage = jobs.filter((j) => NEEDS_TRIAGE_STATUSES.has(j.status) && !(j.dispatch_status || '').trim()).length
    const openQuotes = jobs.filter((j) => QUOTED_STATUSES.has(j.status)).length
    let revenueThisMonthCentsValue: number | null = null
    if (getBackend() === 'postgres') {
      const payments = await listPaymentsSince(new Date(now.getTime() - 40 * DAY_MS).toISOString())
      revenueThisMonthCentsValue = revenueThisMonthCents(payments, now)
    }
    return {
      asOf: now.toISOString(),
      totalJobs: jobs.length,
      byStatus,
      needsTriage,
      openQuotes,
      balanceOwedAfterCompleteCents: balanceOwedCents,
      revenueThisMonthCents: revenueThisMonthCentsValue,
      topLeadSources: topLeadSources(jobs as JobRow[], now, 3),
    }
  },
})

export const TOOLS = [
  findCustomer,
  customerHistory,
  listJobsTool,
  getJob,
  todaySchedule,
  logPhoneJob,
  moveJob,
  addNote,
  businessSnapshot,
] as unknown as ToolDefinition<unknown>[]

export function actorFor(label: string): string {
  return claudeActor(label)
}
