import { z } from 'zod'
import { extractQuoteMeta } from '@/lib/automation/lifecycle'
import { estimateCentsFromDescription } from '@/lib/cart'
import {
  ADD_ON_FLOOR_CENTS,
  ADD_ON_MAX_FULL_CENTS,
  ADD_ON_RATE,
  PRICING,
  SERVICE_MENU,
  SERVICE_PACKAGES,
} from '@/lib/constants'
import { createCustomer, moveJobStatus } from '@/lib/crm/mutations'
import { QUOTE_DESCRIPTION_MAX, QUOTE_TIERS, sendQuote } from '@/lib/crm/quote'
import { FORGE_FAMILY } from '@/lib/family-pricing'
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
// send_quote is the one customer-facing action here: it runs the same core as
// the admin quote page (lib/crm/quote.ts), so a Stripe Payment Link goes out
// by email under the admin-money rate limit. Deliberately absent: charging,
// refunding, cancelling an appointment, anonymizing, any other email.
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
  // Creates live Stripe objects or reaches a customer: the route also applies
  // the tight admin-money limit (5 a minute per person) before running it.
  money?: boolean
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

// ---------------------------------------------------------------------------
// Quotes. price_menu gives Claude the flat-rate numbers, preview_quote builds
// the quote without sending (who gets it, what it says, the last one sent),
// send_quote emails the Stripe Payment Link. Same core as the admin page.
// ---------------------------------------------------------------------------

// A quote may not go out once money has moved or work has started: a re-quote
// flips the job back to Quoted and rewrites the balance owed, which on a paid
// or finished job is damage. The admin site can still do it. Booked alone is
// NOT a reason to refuse: a self-scheduled booking lands as Booked with
// nothing paid (app/api/contact/route.ts), and the quote is what collects it.
const PAST_QUOTING_STATUSES = new Set(['In Progress', 'Complete', 'Payment Failed', 'Refunded', 'Partial Refund'])

export function quoteBlockReason(row: Pick<ContactRow, 'status' | 'deposit_paid_cents'>): string | null {
  if (PAST_QUOTING_STATUSES.has(row.status)) {
    return `The job is ${row.status}; re-quoting a job that far along is done from the admin site.`
  }
  if ((Number(row.deposit_paid_cents || '0') || 0) > 0) {
    return 'A deposit has already been paid on this job; re-quoting it is done from the admin site.'
  }
  return null
}

const dollars = (min: number) =>
  z
    .number()
    .min(min)
    .max(50000)
    .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: 'Use whole cents' })

export const priceMenu = define({
  name: 'price_menu',
  title: 'Price menu',
  description:
    'The flat-rate menu the website sells from: every item with its full price and its add-on price, the numbered bundles, the minimum charge, and the pricing rules. Use it to price a quote before preview_quote.',
  inputSchema: z.object({
    section: z.string().max(60).optional().describe('Part of a section name to narrow to, e.g. "plumbing"'),
  }),
  readOnly: true,
  run: async ({ section }) => {
    const needle = (section || '').trim().toLowerCase()
    const sections = SERVICE_MENU.filter((s) => !needle || s.category.toLowerCase().includes(needle)).map((s) => ({
      category: s.category,
      addOnOnly: Boolean(s.addOnOnly),
      note: s.note || '',
      items: s.items.map((i) => ({
        id: i.id,
        name: i.name,
        price: i.price,
        priceCents: i.priceCents,
        addOnCents: i.addOnCents,
        packageEligible: i.packageEligible,
      })),
    }))
    return {
      minimumChargeCents: PRICING.minimumCharge * 100,
      rules: [
        'The most expensive item in a visit is full price; every further item is its add-on price.',
        `Add-on price is ${Math.round(ADD_ON_RATE * 100)}% of full price rounded down to the nearest $5, floor $${ADD_ON_FLOOR_CENTS / 100}; items at $${ADD_ON_MAX_FULL_CENTS / 100} and up are always full price.`,
        'Small Fixes are the packageEligible items; the numbered bundles cover up to N of them for one price.',
        'Auto Maintenance items ride along with other work, or two or more together to reach the minimum.',
        `Forge Family (friends and family who booked through /family) pay ${Math.round(FORGE_FAMILY.discountRate * 100)}% less, rounded down to the nearest $5; the job description starts with FORGE FAMILY when it applies.`,
        'Quotes are a deposit charged now plus a balance charged at completion; for menu work the whole price is usually the deposit and the balance is $0.',
      ],
      packages: SERVICE_PACKAGES.map((p) => ({
        number: p.number,
        name: p.name,
        scope: p.scope,
        price: p.price,
        priceCents: p.priceCents,
        itemCount: p.itemCount,
        quoteFirst: Boolean(p.quoteFirst),
      })),
      sections,
    }
  },
})

export const previewQuote = define({
  name: 'preview_quote',
  title: 'Preview a quote',
  description:
    'Build a quote for a job without sending it: who it would go to, the amounts and description the email would show, the price the customer already picked at booking if any, the last quote sent, and anything that would block or should give pause. Call this before send_quote and read it back to the person.',
  inputSchema: z.object({
    jobId: z.string().uuid(),
    depositDollars: dollars(0).optional().describe('Defaults to the price picked at booking, if any'),
    balanceDollars: dollars(0).optional().describe('Defaults to 0'),
    tier: z.enum(QUOTE_TIERS).default('medium'),
    description: z.string().max(QUOTE_DESCRIPTION_MAX).optional().describe('Overrides the job description in the email'),
  }),
  readOnly: true,
  run: async ({ jobId, depositDollars, balanceDollars, tier, description }) => {
    const found = await findRowByJobId(jobId)
    if (!found) return { found: false }
    const row = found.row
    const activities = await listActivitiesForJob(jobId)
    const lastQuote = extractQuoteMeta(activities)
    const bookedEstimateCents = estimateCentsFromDescription(row.description)

    const depositCents = depositDollars != null ? Math.round(depositDollars * 100) : bookedEstimateCents ?? 0
    const balanceCents = balanceDollars != null ? Math.round(balanceDollars * 100) : 0
    const emailDescription = ((description ?? '').trim() || row.description || row.service_type).slice(0, QUOTE_DESCRIPTION_MAX)

    const blockers: string[] = []
    if (!row.email) blockers.push('The job has no customer email, so there is nowhere to send the quote.')
    if (!row.name) blockers.push('The job has no customer name.')
    const blocked = quoteBlockReason(row)
    if (blocked) blockers.push(blocked)
    if (depositCents < 100) blockers.push('The deposit must be at least $1.00; pick an amount.')

    const warnings: string[] = []
    if (lastQuote) {
      warnings.push(
        `A quote was already sent on ${lastQuote.sentAt.slice(0, 10)} for $${((lastQuote.depositCents ?? 0) / 100).toFixed(2)} deposit; sending again emails the customer a second link.`,
      )
    }
    if (bookedEstimateCents != null && depositCents + balanceCents !== bookedEstimateCents) {
      warnings.push(
        `The customer picked $${(bookedEstimateCents / 100).toFixed(2)} at booking; this quote totals $${((depositCents + balanceCents) / 100).toFixed(2)}.`,
      )
    }

    return {
      found: true,
      job: { ...compactJob(row), description: row.description },
      sendTo: { name: row.name, email: row.email },
      bookedEstimateCents,
      quote: {
        depositCents,
        balanceCents,
        totalCents: depositCents + balanceCents,
        tier,
        description: emailDescription,
        expiresInDays: 7,
      },
      lastQuote: lastQuote
        ? { sentAt: lastQuote.sentAt, expiresAt: lastQuote.expiresAt, depositCents: lastQuote.depositCents, balanceCents: lastQuote.balanceCents }
        : null,
      canSend: blockers.length === 0,
      blockers,
      warnings,
    }
  },
})

export const sendQuoteTool = define({
  name: 'send_quote',
  title: 'Send a quote',
  description:
    'Email the customer a quote: creates a Stripe Payment Link for the deposit (their card is saved for the balance), sends the quote email, sets the job to Quoted and records the balance owed. This reaches the customer, so run preview_quote first and get a clear yes on the amounts and recipient. Works on self-scheduled Booked jobs; refused once a deposit is paid or the job is In Progress or later.',
  inputSchema: z.object({
    jobId: z.string().uuid(),
    depositDollars: dollars(1).describe('Charged when they pay the link; at least $1.00'),
    balanceDollars: dollars(0).describe('Charged to the saved card at completion; 0 for menu work priced in full up front'),
    tier: z.enum(QUOTE_TIERS).describe('small: half-day or less, medium: full day, large: multi-day'),
    description: z.string().max(QUOTE_DESCRIPTION_MAX).optional().describe('What the email shows as the scope; defaults to the job description'),
  }),
  readOnly: false,
  money: true,
  run: async ({ jobId, depositDollars, balanceDollars, tier, description }, actor) => {
    const found = await findRowByJobId(jobId)
    if (!found) return { ok: false, error: 'Job not found' }
    const blocked = quoteBlockReason(found.row)
    if (blocked) return { ok: false, error: blocked }
    const result = await sendQuote({
      jobId,
      depositCents: Math.round(depositDollars * 100),
      balanceCents: Math.round(balanceDollars * 100),
      tier,
      description,
      actor,
    })
    if (!result.ok) return { ok: false, error: result.error, step: result.step }
    return {
      ok: true,
      sentTo: result.sentTo,
      paymentLinkUrl: result.paymentLinkUrl,
      expiresAt: result.expiresAt,
      depositCents: result.depositCents,
      balanceCents: result.balanceCents,
      status: 'Quoted',
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
  priceMenu,
  previewQuote,
  sendQuoteTool,
] as unknown as ToolDefinition<unknown>[]

export function actorFor(label: string): string {
  return claudeActor(label)
}
