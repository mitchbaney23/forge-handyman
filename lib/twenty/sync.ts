import * as Sentry from '@sentry/nextjs'
import { parsePhoneNumberFromString } from 'libphonenumber-js'
import { SERVICE_LABEL_BY_CODE, type ServiceCategoryCode } from '@/lib/constants'
import { findRowByJobId, getAppointmentByJobId, type ContactRow } from '@/lib/data'
import { logger, maskEmail } from '@/lib/security/logger'

// ---------------------------------------------------------------------------
// Booking form to Twenty: the one-way sync.
//
// The contract lives in the platform repo, businesses/forge-handyman/SYNC.md
// (mitchbaney23/forge-platform). Short version:
//   1. One-way, best-effort, never blocking. Every exported function here
//      resolves; nothing throws past this module. A Twenty outage must never
//      cost a lead. Failures go to Sentry under feature: 'twenty-sync'.
//   2. Twenty never owns payment states. Complete / Payment Failed / Refunded /
//      Partial Refund are Stripe's and are only mirrored.
//   3. Idempotent by stable keys: jobs match on websiteJobId (= jobs.id),
//      people match on email. Update rather than create, and never overwrite a
//      name Twenty learned elsewhere.
//   4. Anonymization sentinels (redacted:<uuid>, unknown:<uuid>) never sync as
//      a person; the job still syncs, unlinked.
//
// Env (Vercel, server side only): TWENTY_API_URL (https://bellowscrm.com/rest),
// TWENTY_API_KEY (generated INSIDE the handyman workspace; keys are workspace
// scoped), TWENTY_SYNC_DISABLED=true as the kill switch. Unset env = off.
// ---------------------------------------------------------------------------

export interface TwentyConfig {
  restUrl: string
  apiKey: string
}

export function getTwentyConfig(): TwentyConfig | null {
  if (process.env.TWENTY_SYNC_DISABLED === 'true') return null
  const url = (process.env.TWENTY_API_URL || '').trim().replace(/\/+$/, '')
  const apiKey = (process.env.TWENTY_API_KEY || '').trim()
  if (!url || !apiKey) return null
  return { restUrl: url.endsWith('/rest') ? url : `${url}/rest`, apiKey }
}

export function isTwentySyncEnabled(): boolean {
  return getTwentyConfig() !== null
}

// ---------------------------------------------------------------------------
// Mapping (pure; unit-tested in tests/twenty-sync.test.ts)
// ---------------------------------------------------------------------------

// Site status text -> Twenty workOrder.status option value. Exact, one to one.
export const STATUS_MAP: Record<string, string> = {
  New: 'NEW',
  Quoted: 'QUOTED',
  'Pending Follow-Up': 'PENDING_FOLLOW_UP',
  Booked: 'BOOKED',
  'In Progress': 'IN_PROGRESS',
  Complete: 'COMPLETE',
  Cancelled: 'CANCELLED',
  'Payment Failed': 'PAYMENT_FAILED',
  Refunded: 'REFUNDED',
  'Partial Refund': 'PARTIAL_REFUND',
}

export const CATEGORY_MAP: Record<string, string> = {
  mounting: 'MOUNTING',
  plumbing: 'PLUMBING',
  electrical: 'ELECTRICAL',
  drywall_paint: 'DRYWALL_PAINT',
  doors_windows: 'DOORS_WINDOWS',
  carpentry: 'CARPENTRY',
  exterior: 'EXTERIOR',
  maintenance: 'MAINTENANCE',
  multiple: 'MULTIPLE',
  other: 'OTHER',
}

export const URGENCY_MAP: Record<string, string> = {
  asap: 'ASAP',
  two_weeks: 'TWO_WEEKS',
  month: 'MONTH',
  flexible: 'FLEXIBLE',
}

export const PROPERTY_TYPE_MAP: Record<string, string> = {
  residential: 'RESIDENTIAL',
  rental: 'RENTAL',
  commercial: 'COMMERCIAL',
  hoa: 'HOA',
  other: 'OTHER',
}

const SENTINEL_EMAIL = /^(redacted|unknown):/i

export function isSentinelEmail(email: string | undefined | null): boolean {
  return SENTINEL_EMAIL.test((email || '').trim())
}

export function mapStatus(siteStatus: string | undefined): string | undefined {
  return STATUS_MAP[(siteStatus || '').trim()]
}

// service_categories is a comma-separated list of codes ('' for the custom
// path). 'multiple' / 'other' come from service_type, set server side.
export function mapCategories(row: Pick<ContactRow, 'service_categories' | 'service_type'>): string[] {
  const codes = (row.service_categories || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const mapped = codes.map((c) => CATEGORY_MAP[c]).filter((v): v is string => Boolean(v))
  if (mapped.length > 0) return mapped
  if ((row.service_type || '').trim() === 'other') return ['OTHER']
  return []
}

// Split on the LAST space; a single word is a first name.
export function splitName(full: string): { firstName: string; lastName: string } {
  const name = (full || '').trim().replace(/\s+/g, ' ')
  const idx = name.lastIndexOf(' ')
  if (idx < 0) return { firstName: name, lastName: '' }
  return { firstName: name.slice(0, idx), lastName: name.slice(idx + 1) }
}

// The site stores phones as E.164 (phoneSchema). Twenty's PHONES composite
// wants the national digits plus the calling code separately.
export function splitPhone(e164: string | undefined): {
  primaryPhoneNumber: string
  primaryPhoneCountryCode: string
  primaryPhoneCallingCode: string
} | null {
  const raw = (e164 || '').trim()
  if (!raw) return null
  const parsed = parsePhoneNumberFromString(raw, 'US')
  if (!parsed) return null
  return {
    primaryPhoneNumber: parsed.nationalNumber,
    primaryPhoneCountryCode: parsed.country || 'US',
    primaryPhoneCallingCode: `+${parsed.countryCallingCode}`,
  }
}

// "<short service summary> - <customer last name>", e.g. "TV mounting - Smith".
// Cart bookings set a descriptive service_type (a package name or "Menu
// order: N items"); category codes get their label; the custom path falls
// back to the first 40 characters of the description.
export function jobName(row: Pick<ContactRow, 'service_type' | 'service_categories' | 'description' | 'name'>): string {
  const serviceType = (row.service_type || '').trim()
  let summary = ''
  if (serviceType && !(serviceType in SERVICE_LABEL_BY_CODE)) {
    summary = serviceType
  } else {
    const codes = (row.service_categories || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (codes.length === 1) {
      // Labels can carry examples in parentheses ("Mounting & assembly (TVs,
      // shelves, furniture)"); the job name wants the short form.
      const label = SERVICE_LABEL_BY_CODE[codes[0] as ServiceCategoryCode] || codes[0]
      summary = label.split(' (')[0].trim()
    } else if (codes.length > 1 || serviceType === 'multiple') {
      summary = 'Multiple things'
    }
  }
  if (!summary) {
    const desc = (row.description || '').replace(/\s+/g, ' ').trim()
    summary = desc ? desc.slice(0, 40).trim() : 'Job'
  }
  const { lastName } = splitName(row.name || '')
  return lastName ? `${summary} - ${lastName}` : summary
}

export function centsToCurrency(cents: string | undefined): { amountMicros: number; currencyCode: 'USD' } | undefined {
  const raw = (cents || '').trim()
  if (!raw) return undefined
  const n = Number(raw)
  if (!Number.isFinite(n)) return undefined
  return { amountMicros: Math.round(n) * 10_000, currencyCode: 'USD' }
}

function datePart(iso: string | undefined): string | undefined {
  const raw = (iso || '').trim()
  if (!raw) return undefined
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

export interface AppointmentWindow {
  startsAt: string
  endsAt: string
}

// Only the columns the contract lists. Anything Twenty owns (workOrderNotes,
// technician, hand edits) is never in this object, so a PATCH cannot touch it.
export function buildJobFields(
  row: ContactRow,
  appointment?: AppointmentWindow | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    websiteJobId: row.job_id,
    name: jobName(row),
    source: 'BOOKING_FORM',
    serviceCategories: mapCategories(row),
    jobAddress: row.address || '',
    description: row.description || '',
    referralSource: row.referral_source || '',
  }
  const status = mapStatus(row.status)
  if (status) fields.status = status
  const propertyType = PROPERTY_TYPE_MAP[(row.property_type || '').trim()]
  if (propertyType) fields.propertyType = propertyType
  const urgency = URGENCY_MAP[(row.urgency || '').trim()]
  if (urgency) fields.urgency = urgency
  if (appointment) {
    fields.scheduledStart = appointment.startsAt
    fields.scheduledEnd = appointment.endsAt
  }
  const completedDate = datePart(row.complete_date)
  if (completedDate) fields.completedDate = completedDate
  const depositPaid = centsToCurrency(row.deposit_paid_cents)
  if (depositPaid) fields.depositPaid = depositPaid
  const balanceOwed = centsToCurrency(row.balance_owed_cents)
  if (balanceOwed) fields.balanceOwed = balanceOwed
  const firstPhoto = (row.photo_urls || '').split(',').map((s) => s.trim()).filter(Boolean)[0]
  if (firstPhoto) fields.photosLink = { primaryLinkUrl: firstPhoto, primaryLinkLabel: 'Photos' }
  return fields
}

export function buildPersonFields(row: Pick<ContactRow, 'name' | 'email' | 'phone'>): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    name: splitName(row.name),
    emails: { primaryEmail: (row.email || '').trim().toLowerCase() },
  }
  const phones = splitPhone(row.phone)
  if (phones) fields.phones = phones
  return fields
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 8_000

export class TwentyHttpError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    body: string,
  ) {
    super(`twenty: ${method} ${path} -> HTTP ${status}: ${body.slice(0, 300)}`)
    this.name = 'TwentyHttpError'
  }
}

async function twentyRequest(
  cfg: TwentyConfig,
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${cfg.restUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })
  const text = await res.text()
  if (!res.ok) throw new TwentyHttpError(res.status, method, path, text)
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    throw new TwentyHttpError(res.status, method, path, `non-JSON body: ${text}`)
  }
}

// REST list filter syntax: field[eq]:"value" (composite: emails.primaryEmail).
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function findOneId(cfg: TwentyConfig, plural: string, filter: string): Promise<string | null> {
  const params = new URLSearchParams({ filter, limit: '1' })
  const out = await twentyRequest(cfg, 'GET', `/${plural}?${params.toString()}`)
  const data = (out.data as Record<string, unknown> | undefined) ?? {}
  const list = data[plural]
  if (!Array.isArray(list) || list.length === 0) return null
  const first = list[0] as { id?: unknown }
  return typeof first.id === 'string' ? first.id : null
}

// Create/update answers look like {data: {createPerson: {...}}}; dig the id out
// without caring about the wrapper key.
function idFromMutation(out: Record<string, unknown>): string | null {
  const data = out.data as Record<string, unknown> | undefined
  if (!data) return null
  for (const value of Object.values(data)) {
    const id = (value as { id?: unknown } | null)?.id
    if (typeof id === 'string') return id
  }
  return null
}

export async function findTwentyPersonId(cfg: TwentyConfig, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  return findOneId(cfg, 'people', `emails.primaryEmail[eq]:${quote(normalized)}`)
}

export async function findTwentyJobId(cfg: TwentyConfig, websiteJobId: string): Promise<string | null> {
  return findOneId(cfg, 'workOrders', `websiteJobId[eq]:${quote(websiteJobId)}`)
}

async function findTwentyQuoteId(cfg: TwentyConfig, twentyJobId: string): Promise<string | null> {
  return findOneId(cfg, 'quotes', `workOrderId[eq]:${quote(twentyJobId)}`)
}

// Match by email, update rather than create, never overwrite the name Twenty
// already has (it may have learned a better one from mail). Only the phone is
// refreshed on an existing person, and only when the site has one.
async function upsertPerson(cfg: TwentyConfig, row: ContactRow): Promise<{ id: string; created: boolean }> {
  const email = (row.email || '').trim().toLowerCase()
  const existing = await findTwentyPersonId(cfg, email)
  if (existing) {
    const phones = splitPhone(row.phone)
    if (phones) await twentyRequest(cfg, 'PATCH', `/people/${existing}`, { phones })
    return { id: existing, created: false }
  }
  const out = await twentyRequest(cfg, 'POST', '/people', buildPersonFields(row))
  const id = idFromMutation(out)
  if (!id) throw new Error('twenty: POST /people returned no id')
  return { id, created: true }
}

async function upsertJob(
  cfg: TwentyConfig,
  row: ContactRow,
  appointment: AppointmentWindow | null | undefined,
  personId: string | null,
): Promise<{ id: string; created: boolean }> {
  const fields = buildJobFields(row, appointment)
  // Set the customer link when we have one; never clear an existing link.
  if (personId) fields.customerId = personId
  const existing = await findTwentyJobId(cfg, row.job_id as string)
  if (existing) {
    await twentyRequest(cfg, 'PATCH', `/workOrders/${existing}`, fields)
    return { id: existing, created: false }
  }
  const out = await twentyRequest(cfg, 'POST', '/workOrders', fields)
  const id = idFromMutation(out)
  if (!id) throw new Error('twenty: POST /workOrders returned no id')
  return { id, created: true }
}

// ---------------------------------------------------------------------------
// Public entry points. None of these throw.
// ---------------------------------------------------------------------------

export type SyncResult =
  | { ok: true; twentyJobId: string; twentyPersonId: string | null; created: boolean }
  | { ok: false; skipped: 'disabled' | 'no-job-id' | 'not-found' }
  | { ok: false; error: string }

function reportFailure(step: string, err: unknown, extra: Record<string, unknown>): { ok: false; error: string } {
  const message = err instanceof Error ? err.message : String(err)
  Sentry.captureException(err, { tags: { feature: 'twenty-sync', step }, extra })
  logger.warn({ err: message, step, ...extra }, 'twenty-sync: failed (non-fatal)')
  return { ok: false, error: message }
}

// Push one job (and its customer) into Twenty. Safe to call after every write
// the site makes to a job; the result is informational only.
export async function syncJobToTwenty(
  row: ContactRow,
  opts: { appointment?: AppointmentWindow | null } = {},
): Promise<SyncResult> {
  const cfg = getTwentyConfig()
  if (!cfg) return { ok: false, skipped: 'disabled' }
  const jobId = (row.job_id || '').trim()
  if (!jobId) return { ok: false, skipped: 'no-job-id' }

  let step = 'person'
  try {
    let personId: string | null = null
    const email = (row.email || '').trim()
    if (email && !isSentinelEmail(email)) {
      personId = (await upsertPerson(cfg, row)).id
    }
    step = 'job'
    const job = await upsertJob(cfg, row, opts.appointment, personId)
    logger.info(
      {
        jobId,
        twentyJobId: job.id,
        created: job.created,
        status: row.status,
        maskedEmail: maskEmail(email || undefined),
      },
      'twenty-sync: job synced',
    )
    return { ok: true, twentyJobId: job.id, twentyPersonId: personId, created: job.created }
  } catch (err) {
    return reportFailure(step, err, { jobId, status: row.status })
  }
}

// For call sites that only hold a jobId (status changes, webhooks): read the
// row and its appointment, then sync. Reads are skipped entirely when the sync
// is off, so this costs nothing in the default configuration.
export async function syncJobById(jobId: string): Promise<SyncResult> {
  if (!isTwentySyncEnabled()) return { ok: false, skipped: 'disabled' }
  try {
    const found = await findRowByJobId(jobId)
    if (!found) return { ok: false, skipped: 'not-found' }
    let appointment: AppointmentWindow | null = null
    try {
      const appt = await getAppointmentByJobId(jobId)
      if (appt && appt.status !== 'cancelled') {
        appointment = { startsAt: appt.startsAt, endsAt: appt.endsAt }
      }
    } catch (err) {
      logger.warn({ err, jobId }, 'twenty-sync: appointment lookup failed, syncing without it')
    }
    return syncJobToTwenty(found.row, { appointment })
  } catch (err) {
    return reportFailure('read-row', err, { jobId })
  }
}

export interface QuoteSyncInput {
  jobId: string
  depositCents: number
  balanceCents: number
  paymentLinkUrl: string
  sentAt?: string
}

export type QuoteSyncResult =
  | { ok: true; twentyQuoteId: string; created: boolean }
  | { ok: false; skipped: 'disabled' | 'not-found' }
  | { ok: false; error: string }

// A sent quote becomes a Quote record on the job (status SENT) and stamps the
// job's quoteTotal. One quote per job: re-sending updates it.
export async function syncQuoteToTwenty(input: QuoteSyncInput): Promise<QuoteSyncResult> {
  const cfg = getTwentyConfig()
  if (!cfg) return { ok: false, skipped: 'disabled' }
  try {
    let twentyJobId = await findTwentyJobId(cfg, input.jobId)
    if (!twentyJobId) {
      const synced = await syncJobById(input.jobId)
      if (!synced.ok) return { ok: false, skipped: 'not-found' }
      twentyJobId = synced.twentyJobId
    }
    const totalCents = input.depositCents + input.balanceCents
    const total = centsToCurrency(String(totalCents))
    const fields: Record<string, unknown> = {
      workOrderId: twentyJobId,
      status: 'SENT',
      deposit: centsToCurrency(String(input.depositCents)),
      balanceDue: centsToCurrency(String(input.balanceCents)),
      total,
      sentDate: datePart(input.sentAt || new Date().toISOString()),
      paymentLink: { primaryLinkUrl: input.paymentLinkUrl, primaryLinkLabel: 'Pay deposit' },
    }
    const existing = await findTwentyQuoteId(cfg, twentyJobId)
    let quoteId: string
    let created: boolean
    if (existing) {
      await twentyRequest(cfg, 'PATCH', `/quotes/${existing}`, fields)
      quoteId = existing
      created = false
    } else {
      const found = await findRowByJobId(input.jobId)
      fields.name = found ? `Quote - ${jobName(found.row)}` : 'Quote'
      const out = await twentyRequest(cfg, 'POST', '/quotes', fields)
      const id = idFromMutation(out)
      if (!id) throw new Error('twenty: POST /quotes returned no id')
      quoteId = id
      created = true
    }
    await twentyRequest(cfg, 'PATCH', `/workOrders/${twentyJobId}`, { quoteTotal: total })
    logger.info({ jobId: input.jobId, twentyQuoteId: quoteId, created }, 'twenty-sync: quote synced')
    return { ok: true, twentyQuoteId: quoteId, created }
  } catch (err) {
    return reportFailure('quote', err, { jobId: input.jobId })
  }
}

// The deposit-paid webhook is the quote's acceptance.
export async function markQuoteAcceptedInTwenty(jobId: string): Promise<void> {
  const cfg = getTwentyConfig()
  if (!cfg) return
  try {
    const twentyJobId = await findTwentyJobId(cfg, jobId)
    if (!twentyJobId) return
    const quoteId = await findTwentyQuoteId(cfg, twentyJobId)
    if (!quoteId) return
    await twentyRequest(cfg, 'PATCH', `/quotes/${quoteId}`, { status: 'ACCEPTED' })
  } catch (err) {
    reportFailure('quote-accepted', err, { jobId })
  }
}

export interface RedactResult {
  ok: boolean
  jobsRedacted: number
  personRedacted: boolean
  error?: string
}

const REDACTED = '[REDACTED]'

// The Twenty side of a customer deletion request: strip PII from every synced
// job for the customer and from the person record, keeping the records (and
// the money fields) for the same reason the site keeps its rows.
export async function redactInTwenty(args: { email: string; jobIds: string[] }): Promise<RedactResult> {
  const cfg = getTwentyConfig()
  if (!cfg) return { ok: true, jobsRedacted: 0, personRedacted: false }
  let jobsRedacted = 0
  let personRedacted = false
  try {
    for (const jobId of args.jobIds) {
      const twentyJobId = await findTwentyJobId(cfg, jobId)
      if (!twentyJobId) continue
      await twentyRequest(cfg, 'PATCH', `/workOrders/${twentyJobId}`, {
        name: REDACTED,
        jobAddress: REDACTED,
        description: REDACTED,
        referralSource: '',
        photosLink: { primaryLinkUrl: '', primaryLinkLabel: '' },
        customerId: null,
      })
      jobsRedacted += 1
    }
    const personId = await findTwentyPersonId(cfg, args.email)
    if (personId) {
      await twentyRequest(cfg, 'PATCH', `/people/${personId}`, {
        name: { firstName: REDACTED, lastName: '' },
        emails: { primaryEmail: `redacted-${personId}@redacted.invalid`, additionalEmails: [] },
        phones: {
          primaryPhoneNumber: '',
          primaryPhoneCountryCode: '',
          primaryPhoneCallingCode: '',
          additionalPhones: [],
        },
        city: '',
        jobTitle: '',
      })
      personRedacted = true
    }
    return { ok: true, jobsRedacted, personRedacted }
  } catch (err) {
    const failure = reportFailure('redact', err, { maskedEmail: maskEmail(args.email), jobsRedacted })
    return { ok: false, jobsRedacted, personRedacted, error: failure.error }
  }
}
