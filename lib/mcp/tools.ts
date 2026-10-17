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
import { createCustomer, createJobForCustomer, moveJobStatus, updateCustomerContact } from '@/lib/crm/mutations'
import { QUOTE_DESCRIPTION_MAX, QUOTE_TIERS, sendQuote } from '@/lib/crm/quote'
import { easternWindow, scheduleJob } from '@/lib/crm/schedule'
import { FORGE_FAMILY } from '@/lib/family-pricing'
import {
  CUSTOM_MAX_QTY,
  CUSTOM_MAX_UNIT_CENTS,
  CUSTOM_NAME_MAX,
  QUOTE_MAX_CUSTOM_LINES,
  QUOTE_MAX_LINES,
  QUOTE_MAX_QTY,
  menuCartFromDescription,
  planMenuQuote,
  type CustomLineInput,
  type ItemizedQuote,
} from '@/lib/quote-lines'
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
import { operationsCalendarEmail } from '@/lib/scheduling/config'
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
// by email under the admin-money rate limit. create_job with a schedule writes
// to the operations Google Calendar, and the day-before reminder cron then
// emails the customer as it does for any booking. Deliberately absent: charging,
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
    'Look up customers by email, phone, or part of a name. Returns up to 10 matches with their id, contact details, job count, last job date and total spent (cents). Use the id with customer_history, update_customer or create_job.',
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
  totalSpentCents: string
}) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    jobCount: c.jobCount,
    lastJobAt: c.lastJobAt,
    totalSpentCents: Number(c.totalSpentCents || '0') || 0,
    notes: c.notes,
  }
}

export const customerHistory = define({
  name: 'customer_history',
  title: 'Customer history',
  description: 'Everything about one customer: contact details, notes, total spent with Forge (deposits + balances − refunds, in cents), their properties, and every job with status and money.',
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
    'Record a job that came in by phone, text or referral from someone NEW: creates the customer (or links an existing one by email) and a job at New. For a customer already on file use create_job with their id instead. David is NOT notified by this; dispatch him from the admin site when the job is ready. Read the result back to the caller.',
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

const scheduleInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD, Eastern'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).describe('HH:MM, 24-hour, Eastern'),
  durationMinutes: z.number().int().min(30).max(720),
  emailCustomer: z
    .boolean()
    .default(true)
    .describe('Email the customer a confirmation with the date and time (default true)'),
})

export const updateCustomer = define({
  name: 'update_customer',
  title: 'Update a customer',
  description:
    "Change a customer's name, phone or email (find_customer gives the id). Leave a field out to keep it; pass an empty string to clear phone or email. The change is copied onto all of their jobs, so future quotes, balance links and reminders use it. Refused if another customer already has the email. Read the change back to the person before making it.",
  inputSchema: z.object({
    customerId: z.string().uuid(),
    name: z.string().min(1).max(120).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().max(160).optional(),
  }),
  readOnly: false,
  run: async ({ customerId, name, phone, email }, actor) =>
    updateCustomerContact({ customerId, changes: { name, phone, email }, actor }),
})

export const createJob = define({
  name: 'create_job',
  title: 'Create a job for a customer',
  description:
    `Add a new job for a customer already on file (find_customer gives the id). It lands at New. With schedule, it also books that Eastern-time slot, puts it on the ${operationsCalendarEmail()} Google Calendar, sets the job to Booked and holds the time so the website can't double-book it; the customer is emailed a confirmation (unless emailCustomer is false) and a reminder the day before, and the office gets a notice. Read the date, time and length back and get a clear yes before scheduling. David is NOT notified; dispatch him from the admin site.`,
  inputSchema: z.object({
    customerId: z.string().uuid(),
    serviceType: z.string().min(1).max(120).describe('Short description of the service, e.g. "TV mounting"'),
    description: z.string().min(1).max(2000).describe('What needs doing, in the customer\'s words'),
    address: z.string().max(300).optional().describe('Defaults to blank; customer_history lists the addresses on file'),
    urgency: z.enum(['asap', 'two_weeks', 'month', 'flexible']).optional(),
    referralSource: z.string().max(120).optional(),
    preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD; ignored when schedule is given'),
    schedule: scheduleInput.optional(),
  }),
  readOnly: false,
  run: async ({ customerId, serviceType, description, address, urgency, referralSource, preferredDate, schedule }, actor) => {
    let window: { startsAt: string; endsAt: string; emailCustomer: boolean } | undefined
    if (schedule) {
      const w = easternWindow(schedule)
      if (!w) return { ok: false, error: 'That date and time is not a real Eastern time.' }
      window = { ...w, emailCustomer: schedule.emailCustomer !== false }
    }
    return createJobForCustomer({
      customerId,
      job: {
        serviceType,
        description,
        address,
        urgency,
        referralSource,
        preferredDate: schedule ? schedule.date : preferredDate,
      },
      schedule: window,
      actor,
    })
  },
})

export const scheduleJobTool = define({
  name: 'schedule_job',
  title: 'Schedule a job',
  description:
    `Book a time for a job that has no appointment yet (a website lead, a phone job, or one whose scheduling failed). Puts it on the ${operationsCalendarEmail()} Google Calendar, sets the job to Booked and holds the time so the website can't double-book it; the customer is emailed a confirmation (unless emailCustomer is false) and a reminder the day before, and the office gets a notice. Refused if the time overlaps another booking or the job is already scheduled. Read the date, time and length back and get a clear yes first. David is NOT notified.`,
  inputSchema: z.object({ jobId: z.string().uuid() }).merge(scheduleInput),
  readOnly: false,
  run: async ({ jobId, date, startTime, durationMinutes, emailCustomer }, actor) => {
    const window = easternWindow({ date, startTime, durationMinutes })
    if (!window) return { ok: false, error: 'That date and time is not a real Eastern time.' }
    return scheduleJob({ jobId, ...window, emailCustomer, actor })
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
// A quote is a list of lines in any mix: menu items (ids + quantities, priced
// by the add-on engine in lib/quote-lines.ts — Claude never supplies a menu
// price), a bundle, and custom lines Claude types (travel fee, materials, a
// discount, the #3 Whole List), charged as entered. A bare deposit + balance
// with no lines still works.
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

const menuItems = z
  .array(
    z.object({
      id: z.string().max(60).describe('A menu item id from price_menu'),
      qty: z.number().int().min(1).max(QUOTE_MAX_QTY),
    }),
  )
  .max(QUOTE_MAX_LINES)
const menuPackage = z.number().int().min(1).max(9)
const customLines = z
  .array(
    z.object({
      name: z.string().min(1).max(CUSTOM_NAME_MAX).describe('What the customer sees, e.g. "Travel fee (Benson)"'),
      qty: z.number().int().min(1).max(CUSTOM_MAX_QTY).default(1),
      unitDollars: z
        .number()
        .min(-CUSTOM_MAX_UNIT_CENTS / 100)
        .max(CUSTOM_MAX_UNIT_CENTS / 100)
        .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, { message: 'Use whole cents' })
        .describe('Price of one; negative for a discount or credit, 0 for something included'),
    }),
  )
  .max(QUOTE_MAX_CUSTOM_LINES)

// The lines a tool call asked for, or null for a bare deposit/balance quote.
function linesFrom(
  items: { id: string; qty: number }[] | undefined,
  packageNumber: number | undefined,
  custom: { name: string; qty: number; unitDollars: number }[] | undefined,
): { menu: { items: { id: string; qty: number }[]; packageNumber: number | null }; customLines: CustomLineInput[] } | null {
  if (!items?.length && packageNumber == null && !custom?.length) return null
  return {
    menu: { items: items ?? [], packageNumber: packageNumber ?? null },
    customLines: (custom ?? []).map((c) => ({ name: c.name, qty: c.qty, unitCents: Math.round(c.unitDollars * 100) })),
  }
}

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
        'A quote is lines in any mix: items [{ id, qty }] from this menu (and packageNumber 1 or 2 for a bundle), priced line by line with these rules, Forge Family included; plus customLines [{ name, qty, unitDollars }] for anything else (a travel fee, materials, disposal, the #3 Whole List, a discount as a negative price), charged exactly as given. The email lists every line.',
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
    'Build a quote for a job without sending it: who it would go to, the lines and amounts the email would show, the price and items the customer picked at booking if any, the last quote sent, and anything that would block or should give pause. Pass menu items, customLines (travel fee, materials, a discount, anything off the menu) or both. Call this before send_quote and read it back to the person.',
  inputSchema: z.object({
    jobId: z.string().uuid(),
    items: menuItems.optional().describe('Menu items and quantities; prices come from the menu. bookedItems in a preview without items is what the customer picked.'),
    packageNumber: menuPackage.optional().describe('1 or 2 to include a fixed-price bundle'),
    customLines: customLines.optional().describe('Lines off the menu, charged as given'),
    depositDollars: dollars(0)
      .optional()
      .describe('With lines: defaults to the whole total. Bare amount: defaults to the price picked at booking, if any'),
    balanceDollars: dollars(0).optional().describe('Bare amount only; defaults to 0. With lines the balance is the total minus the deposit'),
    tier: z.enum(QUOTE_TIERS).default('medium'),
    description: z
      .string()
      .max(QUOTE_DESCRIPTION_MAX)
      .optional()
      .describe('Bare amount: overrides the job description in the email. With lines: an optional note above them'),
  }),
  readOnly: true,
  run: async ({ jobId, items, packageNumber, customLines: custom, depositDollars, balanceDollars, tier, description }) => {
    const found = await findRowByJobId(jobId)
    if (!found) return { found: false }
    const row = found.row
    const activities = await listActivitiesForJob(jobId)
    const lastQuote = extractQuoteMeta(activities)
    const bookedEstimateCents = estimateCentsFromDescription(row.description)
    const booked = menuCartFromDescription(row.description)
    const lines = linesFrom(items, packageNumber, custom)

    const blockers: string[] = []
    if (!row.email) blockers.push('The job has no customer email, so there is nowhere to send the quote.')
    if (!row.name) blockers.push('The job has no customer name.')
    const blocked = quoteBlockReason(row)
    if (blocked) blockers.push(blocked)

    let depositCents: number
    let balanceCents: number
    let emailDescription: string
    let itemized: ItemizedQuote | null = null
    if (lines) {
      if (balanceDollars != null) {
        blockers.push('With lines the balance is the quote total minus the deposit; leave balanceDollars out.')
      }
      const plan = planMenuQuote(
        lines.menu,
        row.description,
        depositDollars != null ? Math.round(depositDollars * 100) : undefined,
        lines.customLines,
      )
      if (plan.ok) {
        ;({ depositCents, balanceCents } = plan)
        itemized = plan.quote
      } else {
        blockers.push(plan.error)
        depositCents = 0
        balanceCents = 0
      }
      emailDescription = (description ?? '').trim().slice(0, QUOTE_DESCRIPTION_MAX)
    } else {
      depositCents = depositDollars != null ? Math.round(depositDollars * 100) : bookedEstimateCents ?? 0
      balanceCents = balanceDollars != null ? Math.round(balanceDollars * 100) : 0
      emailDescription = ((description ?? '').trim() || row.description || row.service_type).slice(0, QUOTE_DESCRIPTION_MAX)
      if (depositCents < 100) blockers.push('The deposit must be at least $1.00; pick an amount.')
    }

    const warnings: string[] = []
    if (lastQuote) {
      warnings.push(
        `A quote was already sent on ${lastQuote.sentAt.slice(0, 10)} for $${((lastQuote.depositCents ?? 0) / 100).toFixed(2)} deposit; sending again emails the customer a second link.`,
      )
    }
    const priced = !lines || itemized != null
    if (priced && bookedEstimateCents != null && depositCents + balanceCents !== bookedEstimateCents) {
      warnings.push(
        `The customer picked $${(bookedEstimateCents / 100).toFixed(2)} at booking; this quote totals $${((depositCents + balanceCents) / 100).toFixed(2)}.`,
      )
    }
    if (!lines && booked && (booked.cart.items.length > 0 || booked.cart.packageNumber != null)) {
      warnings.push('The customer picked menu items at booking (bookedItems); pass them as items to send an itemized quote.')
    }
    if (booked && booked.unmatched.length > 0) {
      warnings.push(`Booked but no longer on the menu: ${booked.unmatched.join(', ')}. Add them as customLines with a price if they are still part of the job.`)
    }

    return {
      found: true,
      job: { ...compactJob(row), description: row.description },
      sendTo: { name: row.name, email: row.email },
      bookedEstimateCents,
      bookedItems: booked ? { ...booked.cart, notOnMenu: booked.unmatched } : null,
      quote: {
        pricing: lines ? 'lines' : 'amount',
        ...(itemized ? { lines: itemized.lines, family: itemized.family } : {}),
        depositCents,
        balanceCents,
        totalCents: depositCents + balanceCents,
        tier,
        description: emailDescription,
        expiresInDays: 7,
      },
      lastQuote: lastQuote
        ? {
            sentAt: lastQuote.sentAt,
            expiresAt: lastQuote.expiresAt,
            depositCents: lastQuote.depositCents,
            balanceCents: lastQuote.balanceCents,
            ...(lastQuote.itemized ? { lines: lastQuote.itemized.lines, totalCents: lastQuote.itemized.totalCents } : {}),
          }
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
    'Email the customer a quote: creates a Stripe Payment Link for the deposit (their card is saved for the balance), sends the quote email, sets the job to Quoted and records the balance owed. Pass menu items, customLines or both, as previewed (the deposit defaults to the whole total). This reaches the customer, so run preview_quote first and get a clear yes on the lines, amounts and recipient. Works on self-scheduled Booked jobs; refused once a deposit is paid or the job is In Progress or later.',
  inputSchema: z.object({
    jobId: z.string().uuid(),
    items: menuItems.optional().describe('Menu items and quantities, as previewed; prices come from the menu'),
    packageNumber: menuPackage.optional().describe('1 or 2 to include a fixed-price bundle'),
    customLines: customLines.optional().describe('Lines off the menu, as previewed, charged as given'),
    depositDollars: dollars(1)
      .optional()
      .describe('Charged when they pay the link; at least $1.00. With lines it defaults to the whole total; required for a bare amount'),
    balanceDollars: dollars(0)
      .optional()
      .describe('Bare amount only (required there): charged to the saved card at completion. With lines the balance is the total minus the deposit'),
    tier: z.enum(QUOTE_TIERS).describe('small: half-day or less, medium: full day, large: multi-day'),
    description: z
      .string()
      .max(QUOTE_DESCRIPTION_MAX)
      .optional()
      .describe('Bare amount: what the email shows as the scope; defaults to the job description. With lines: an optional note above them'),
  }),
  readOnly: false,
  money: true,
  run: async ({ jobId, items, packageNumber, customLines: custom, depositDollars, balanceDollars, tier, description }, actor) => {
    const lines = linesFrom(items, packageNumber, custom)
    if (lines && balanceDollars != null) {
      return { ok: false, error: 'With lines the balance is the quote total minus the deposit; leave balanceDollars out.' }
    }
    if (!lines && (depositDollars == null || balanceDollars == null)) {
      return { ok: false, error: 'Pass items or customLines for an itemized quote, or both depositDollars and balanceDollars for a bare amount.' }
    }
    const found = await findRowByJobId(jobId)
    if (!found) return { ok: false, error: 'Job not found' }
    const blocked = quoteBlockReason(found.row)
    if (blocked) return { ok: false, error: blocked }
    const result = await sendQuote(
      lines
        ? {
            jobId,
            menu: lines.menu,
            customLines: lines.customLines,
            ...(depositDollars != null ? { depositCents: Math.round(depositDollars * 100) } : {}),
            tier,
            description,
            actor,
          }
        : {
            jobId,
            depositCents: Math.round(depositDollars! * 100),
            balanceCents: Math.round(balanceDollars! * 100),
            tier,
            description,
            actor,
          },
    )
    if (!result.ok) return { ok: false, error: result.error, step: result.step }
    return {
      ok: true,
      sentTo: result.sentTo,
      paymentLinkUrl: result.paymentLinkUrl,
      expiresAt: result.expiresAt,
      depositCents: result.depositCents,
      balanceCents: result.balanceCents,
      ...(result.itemized ? { lines: result.itemized.lines, totalCents: result.itemized.totalCents } : {}),
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
  updateCustomer,
  createJob,
  scheduleJobTool,
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
