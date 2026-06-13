// Pure helpers for scripts/migrate-sheet-to-db.ts.
//
// EVERY export here is a pure function (or constant): no I/O, no env reads,
// no Google/Supabase clients — so the parsing, grouping, and dedupe logic is
// unit-testable without credentials. node:crypto is used only for sha1
// hashing (deterministic UUIDv5), which is pure computation.
//
// Background (docs/stage-13-postgres-design.md, "Migration script"): Sheet1
// cells were written with valueInputOption USER_ENTERED, so Google Sheets
// coerced values — booleans render as 'TRUE', numbers grow thousands
// separators ('4,500'), dates flip to 'M/D/YYYY', and leading '+' signs get
// eaten off phone numbers. These helpers normalize those FORMATTED_VALUE
// artifacts back into the canonical shapes lib/data/pg/mappers.ts expects.

import { createHash } from 'node:crypto'
import { SHEET_HEADERS, type SheetColumn } from '@/lib/sheet/repo'
import { isUuid, type DbJobInsert } from '@/lib/data/pg/mappers'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Must match VALID_STATUSES in app/admin/jobs/[id]/actions.ts (10 values).
// Not imported from there: that module is 'use server' and pulls next-auth /
// Sentry / Stripe into any process that loads it.
export const VALID_STATUSES: ReadonlySet<string> = new Set([
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
])

// Anonymization sentinel written by app/admin/data-requests/actions.ts.
export const REDACTED_SENTINEL = '[REDACTED]'

// Namespace for deterministic UUIDv5 ids minted for legacy rows that are
// missing (or carry an invalid) job_id, and for grouped customer ids.
// DO NOT CHANGE: ids must be stable across migration runs (--execute today,
// --verify after cutover must mint the same ids).
export const MIGRATION_UUID_NAMESPACE = '7c0884d7-ee41-4e9f-b8c2-1d6e3a5f9b04'

// ---------------------------------------------------------------------------
// Deterministic UUIDv5 (RFC 4122 §4.3) via node:crypto sha1 — implemented
// inline so the repo does not grow a uuid dependency.
// ---------------------------------------------------------------------------

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex')
}

export function uuidv5(name: string, namespace: string): string {
  const digest = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC 4122 variant
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// Stable id for a sheet row with a missing/invalid job_id. Inputs are the
// RAW cell values (no parsing) so the id never shifts when parsing rules do.
export function deterministicJobId(rowNumber: number, submittedAt: string, email: string): string {
  return uuidv5(`${rowNumber}|${submittedAt}|${email}`, MIGRATION_UUID_NAMESPACE)
}

// Stable id for a grouped (real-email) customer. 'customer:' prefix keeps the
// name space disjoint from job names (which always contain two '|').
export function deterministicCustomerId(emailKey: string): string {
  return uuidv5(`customer:${emailKey}`, MIGRATION_UUID_NAMESPACE)
}

// ---------------------------------------------------------------------------
// FORMATTED_VALUE cell parsers. Each returns the best-effort value plus an
// optional `issue` message; the plan builder decides the severity (the cents/
// date/timestamp/status issues fail validation; boolean/phone issues are
// report-only warnings).
// ---------------------------------------------------------------------------

export interface ParseResult<T> {
  value: T
  issue?: string
}

// Truthy iff trim().toLowerCase() === 'true' (Sheets renders booleans as
// 'TRUE'). '' → false. Any other non-empty value is falsy but reported.
export function parseSheetBoolean(cell: string): ParseResult<boolean> {
  const trimmed = cell.trim()
  if (trimmed === '') return { value: false }
  if (trimmed.toLowerCase() === 'true') return { value: true }
  return { value: false, issue: `non-boolean cell ${JSON.stringify(cell)} treated as false` }
}

// Integer cents/counts: strip thousands separators ('4,500'), then require
// digits-only. '' → null (the sheet's "absent", ≠ '0').
export function parseSheetCents(cell: string): ParseResult<number | null> {
  const trimmed = cell.trim()
  if (trimmed === '') return { value: null }
  const digits = trimmed.replace(/,/g, '')
  if (!/^\d+$/.test(digits)) {
    return { value: null, issue: `expected an integer cell, got ${JSON.stringify(cell)}` }
  }
  const n = Number(digits)
  if (!Number.isSafeInteger(n)) {
    return { value: null, issue: `integer cell out of safe range: ${JSON.stringify(cell)}` }
  }
  // Target columns (deposit/balance_owed_cents, review_send_count,
  // prior_job_count) are Postgres int4 — a value above its max passes JS's
  // safe-integer check but would 22003-overflow mid-INSERT, after TRUNCATE.
  // Catch it in the dry-run validation pass instead.
  if (n > 2_147_483_647) {
    return { value: null, issue: `integer cell exceeds int4 range: ${JSON.stringify(cell)}` }
  }
  return { value: n }
}

// E.164 passes through. Sheets ate leading '+' signs off USER_ENTERED phones,
// so digits-only 11-digit-leading-1 → '+<digits>' and 10-digit → '+1<digits>'.
// Anything else is kept exactly as-is and reported for human review.
export function normalizePhone(cell: string): ParseResult<string> {
  const trimmed = cell.trim()
  if (trimmed === '') return { value: '' }
  if (/^\+[1-9]\d{1,14}$/.test(trimmed)) return { value: trimmed }
  if (/^1\d{10}$/.test(trimmed)) return { value: `+${trimmed}` }
  if (/^\d{10}$/.test(trimmed)) return { value: `+1${trimmed}` }
  return { value: cell, issue: `unrecognized phone format kept as-is: ${JSON.stringify(cell)}` }
}

function ymdToIso(y: number, m: number, d: number, cell: string): ParseResult<string | null> {
  const roundTrip = new Date(Date.UTC(y, m - 1, d))
  if (
    roundTrip.getUTCFullYear() !== y ||
    roundTrip.getUTCMonth() !== m - 1 ||
    roundTrip.getUTCDate() !== d
  ) {
    return { value: null, issue: `impossible calendar date ${JSON.stringify(cell)}` }
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return { value: `${String(y).padStart(4, '0')}-${pad(m)}-${pad(d)}` }
}

// 'YYYY-MM-DD' passes through; Sheets-coerced 'M/D/YYYY' is normalized to
// ISO; '' → null; anything else is reported (fails validation).
export function normalizePreferredDate(cell: string): ParseResult<string | null> {
  const trimmed = cell.trim()
  if (trimmed === '') return { value: null }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (iso) return ymdToIso(Number(iso[1]), Number(iso[2]), Number(iso[3]), cell)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed)
  if (us) return ymdToIso(Number(us[3]), Number(us[1]), Number(us[2]), cell)
  return { value: null, issue: `unparseable date ${JSON.stringify(cell)}` }
}

// Anything new Date() can parse is canonicalized through toISOString() —
// byte-identical to what the sheet layer wrote, which lexicographic
// comparisons downstream depend on. '' → null; unparseable → reported.
export function parseSheetTimestamp(cell: string): ParseResult<string | null> {
  const trimmed = cell.trim()
  if (trimmed === '') return { value: null }
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) {
    return { value: null, issue: `unparseable timestamp ${JSON.stringify(cell)}` }
  }
  return { value: date.toISOString() }
}

// Statuses are trimmed before validation and stored trimmed; unknown values
// fail validation loudly.
export function validateStatus(cell: string): ParseResult<string> {
  const trimmed = cell.trim()
  if (!VALID_STATUSES.has(trimmed)) {
    return { value: trimmed, issue: `unknown status ${JSON.stringify(cell)} (not in VALID_STATUSES)` }
  }
  return { value: trimmed }
}

// ---------------------------------------------------------------------------
// Sheet row plumbing
// ---------------------------------------------------------------------------

export interface RawSheetRow {
  // 1-based sheet row number, header-inclusive (first data row = 2) — same
  // convention as JobRow.rowNumber.
  rowNumber: number
  // All 36 columns as raw strings, missing cells coerced to ''.
  cells: Record<SheetColumn, string>
}

// Complete a sparse ContactRow-ish object into all 36 raw cells (the sheet
// layer's `row[header] ?? ''` semantics).
export function rawCellsFromContactRow(
  row: Partial<Record<SheetColumn, string>>,
): Record<SheetColumn, string> {
  const cells = {} as Record<SheetColumn, string>
  for (const header of SHEET_HEADERS) cells[header] = row[header] ?? ''
  return cells
}

function splitList(cell: string): string[] {
  return cell === '' ? [] : cell.split(',')
}

// ---------------------------------------------------------------------------
// Migration plan — the pure core of the script. Takes raw sheet rows, returns
// everything --execute needs to write plus every anomaly for the report.
// ---------------------------------------------------------------------------

export interface MigrationIssue {
  severity: 'error' | 'warning'
  rowNumber: number | null
  field: string
  message: string
}

export interface JobLegacy {
  rowNumber: number
  sheetRow: Record<SheetColumn, string>
  // Present when the row carried a non-empty, non-UUID job_id.
  invalidJobId?: string
  // Raw rows discarded by duplicate-job_id keep-first dedupe.
  duplicates?: { rowNumber: number; sheetRow: Record<SheetColumn, string> }[]
}

// A jobs-table insert: mapper insert shape plus the migration-owned columns.
// submitted_at is narrowed to string — validation guarantees it.
export type PlannedJob = Omit<DbJobInsert, 'submitted_at'> & {
  submitted_at: string
  customer_id: string
  legacy: JobLegacy
  anonymized_at: string | null
}

export interface PlannedCustomer {
  id: string
  name: string
  phone: string
  email: string
  anonymized_at: string | null
}

export interface MigrationPlan {
  ok: boolean
  totalSheetRows: number
  jobs: PlannedJob[]
  customers: PlannedCustomer[]
  issues: MigrationIssue[]
  // Prominent report sections (not duplicated into `issues`):
  duplicateJobIds: { jobId: string; keptRowNumber: number; discardedRowNumbers: number[] }[]
  mintedJobIds: { rowNumber: number; jobId: string; invalidValue?: string }[]
  // Rows that failed validation (error-severity issues) and were excluded
  // from jobs[]. Any entry here means ok === false: --execute must not write.
  excludedRowNumbers: number[]
}

type PendingJob = Omit<PlannedJob, 'customer_id'>

interface IdAssignedRow {
  row: RawSheetRow
  id: string
  invalidValue?: string
  duplicates: RawSheetRow[]
}

export function buildMigrationPlan(rows: RawSheetRow[], nowIso: string): MigrationPlan {
  const issues: MigrationIssue[] = []
  const mintedJobIds: MigrationPlan['mintedJobIds'] = []
  const duplicateJobIds: MigrationPlan['duplicateJobIds'] = []
  const excludedRowNumbers: number[] = []

  // 1. Assign every row an id: trimmed job_id when it is UUID-shaped,
  //    otherwise a deterministic UUIDv5 (stable across runs).
  const assigned: { row: RawSheetRow; id: string; invalidValue?: string }[] = rows.map((row) => {
    const rawId = row.cells.job_id.trim()
    if (isUuid(rawId)) return { row, id: rawId.toLowerCase() }
    const id = deterministicJobId(row.rowNumber, row.cells.submitted_at, row.cells.email)
    const invalidValue = rawId === '' ? undefined : rawId
    mintedJobIds.push(
      invalidValue === undefined ? { rowNumber: row.rowNumber, jobId: id } : { rowNumber: row.rowNumber, jobId: id, invalidValue },
    )
    return invalidValue === undefined ? { row, id } : { row, id, invalidValue }
  })

  // 2. Duplicate job_ids: keep the FIRST occurrence (matches findRowByJobId's
  //    first-match read semantics — the first row is the one webhooks
  //    updated). Later duplicates are stashed raw in legacy.duplicates and
  //    never parsed/validated (they are not written as rows).
  const byId = new Map<string, IdAssignedRow>()
  for (const entry of assigned) {
    const existing = byId.get(entry.id)
    if (existing) {
      existing.duplicates.push(entry.row)
      continue
    }
    byId.set(entry.id, { ...entry, duplicates: [] })
  }
  for (const kept of byId.values()) {
    if (kept.duplicates.length === 0) continue
    duplicateJobIds.push({
      jobId: kept.id,
      keptRowNumber: kept.row.rowNumber,
      discardedRowNumbers: kept.duplicates.map((d) => d.rowNumber),
    })
  }

  // 3. Parse + validate every kept row.
  const pending: { job: PendingJob; emailKind: 'grouped' | 'redacted' | 'unknown'; emailKey: string }[] = []

  for (const kept of byId.values()) {
    const { cells } = kept.row
    const rowNumber = kept.row.rowNumber
    let fatal = false
    const fail = (field: string, message: string): void => {
      issues.push({ severity: 'error', rowNumber, field, message })
      fatal = true
    }
    const warn = (field: string, message: string): void => {
      issues.push({ severity: 'warning', rowNumber, field, message })
    }

    // submitted_at: NOT NULL in jobs — empty or unparseable fails loudly.
    let submittedAt = ''
    if (cells.submitted_at.trim() === '') {
      fail('submitted_at', 'empty submitted_at (jobs.submitted_at is NOT NULL)')
    } else {
      const parsed = parseSheetTimestamp(cells.submitted_at)
      if (parsed.value === null) fail('submitted_at', parsed.issue ?? 'unparseable timestamp')
      else submittedAt = parsed.value
    }

    const status = validateStatus(cells.status)
    if (status.issue) fail('status', status.issue)

    const preferredDate = normalizePreferredDate(cells.preferred_date)
    if (preferredDate.issue) fail('preferred_date', preferredDate.issue)

    const timestampField = (field: SheetColumn): string | null => {
      const parsed = parseSheetTimestamp(cells[field])
      if (parsed.issue) fail(field, parsed.issue)
      return parsed.value
    }
    const centsField = (field: SheetColumn): number | null => {
      const parsed = parseSheetCents(cells[field])
      if (parsed.issue) fail(field, parsed.issue)
      return parsed.value
    }
    const boolField = (field: SheetColumn): boolean => {
      const parsed = parseSheetBoolean(cells[field])
      if (parsed.issue) warn(field, parsed.issue)
      return parsed.value
    }

    // Phone: anonymized rows keep the literal sentinel without a warning;
    // everything else goes through FORMATTED_VALUE normalization.
    let phone = cells.phone
    if (cells.phone.trim() !== REDACTED_SENTINEL) {
      const parsed = normalizePhone(cells.phone)
      if (parsed.issue) warn('phone', parsed.issue)
      phone = parsed.value
    }

    const legacy: JobLegacy = { rowNumber, sheetRow: cells }
    if (kept.invalidValue !== undefined) legacy.invalidJobId = kept.invalidValue
    if (kept.duplicates.length > 0) {
      legacy.duplicates = kept.duplicates.map((d) => ({ rowNumber: d.rowNumber, sheetRow: d.cells }))
    }

    const emailTrim = cells.email.trim()
    const isRedacted = emailTrim === REDACTED_SENTINEL
    const emailKind = isRedacted ? 'redacted' : emailTrim === '' ? 'unknown' : 'grouped'

    const job: PendingJob = {
      id: kept.id,
      submitted_at: submittedAt,
      name: cells.name,
      phone,
      email: emailTrim,
      address: cells.address,
      service_type: cells.service_type,
      preferred_date: preferredDate.value,
      description: cells.description,
      referral_source: cells.referral_source,
      status: status.value,
      complete_date: timestampField('complete_date'),
      review_sent_at: timestampField('review_sent_at'),
      review_send_count: centsField('review_send_count'),
      review_received: boolField('review_received'),
      seasonal_nudge_last_sent: timestampField('seasonal_nudge_last_sent'),
      opt_out: boolField('opt_out'),
      first_touch_sent_at: timestampField('first_touch_sent_at'),
      // hours_to_first_touch: generated column — the raw cell survives in
      // legacy.sheetRow; Postgres recomputes the value.
      utm_source: cells.utm_source,
      stripe_customer_id: cells.stripe_customer_id,
      stripe_payment_method_id: cells.stripe_payment_method_id,
      deposit_paid_cents: centsField('deposit_paid_cents'),
      balance_owed_cents: centsField('balance_owed_cents'),
      service_categories: splitList(cells.service_categories),
      property_type: cells.property_type,
      urgency: cells.urgency,
      best_contact_time: cells.best_contact_time,
      best_contact_method: cells.best_contact_method,
      photo_urls: splitList(cells.photo_urls),
      is_returning_customer: boolField('is_returning_customer'),
      prior_job_count: centsField('prior_job_count'),
      dispatch_status: cells.dispatch_status,
      dispatch_decision: cells.dispatch_decision,
      dispatch_decided_at: timestampField('dispatch_decided_at'),
      telegram_message_id: cells.telegram_message_id,
      legacy,
      anonymized_at: isRedacted ? nowIso : null, // jobs.anonymized_at backfill
    }

    if (fatal) {
      excludedRowNumbers.push(rowNumber)
      continue
    }
    pending.push({ job, emailKind, emailKey: emailKind === 'grouped' ? emailTrim.toLowerCase() : '' })
  }

  // 4. Customers. Real emails group by lower(trim(email)); '[REDACTED]' and
  //    '' emails get ONE customer per row with a sentinel email carrying the
  //    job's id for determinism.
  const customers: PlannedCustomer[] = []
  const jobs: PlannedJob[] = []
  const grouped = new Map<string, { id: string; members: PendingJob[] }>()

  for (const { job, emailKind, emailKey } of pending) {
    if (emailKind === 'redacted') {
      // Mirror redactCustomerByEmail's shape exactly: name + phone '[REDACTED]',
      // notes '' (DB default), email 'redacted:<id>' sentinel.
      customers.push({
        id: job.id,
        name: REDACTED_SENTINEL,
        phone: REDACTED_SENTINEL,
        email: `redacted:${job.id}`,
        anonymized_at: nowIso,
      })
      jobs.push({ ...job, customer_id: job.id })
    } else if (emailKind === 'unknown') {
      customers.push({
        id: job.id,
        name: job.name,
        phone: job.phone,
        email: `unknown:${job.id}`,
        anonymized_at: null,
      })
      jobs.push({ ...job, customer_id: job.id })
    } else {
      let group = grouped.get(emailKey)
      if (!group) {
        group = { id: deterministicCustomerId(emailKey), members: [] }
        grouped.set(emailKey, group)
      }
      group.members.push(job)
      jobs.push({ ...job, customer_id: group.id })
    }
  }

  for (const [emailKey, group] of grouped) {
    // Newest-wins name/phone, matching the pg repo's upsert (which only
    // overwrites with non-empty incoming values): replay rows oldest→newest
    // (submitted_at, then rowNumber as the tiebreak) and let non-empty
    // values win.
    const sorted = [...group.members].sort((a, b) => {
      if (a.submitted_at !== b.submitted_at) return a.submitted_at < b.submitted_at ? -1 : 1
      return a.legacy.rowNumber - b.legacy.rowNumber
    })
    let name = ''
    let phone = ''
    for (const member of sorted) {
      if (member.name !== '') name = member.name
      if (member.phone !== '') phone = member.phone
    }
    customers.push({ id: group.id, name, phone, email: emailKey, anonymized_at: null })
  }

  // 5. Schema-constraint assertions over the finished plan (FK resolvability
  //    and the citext-unique email index). All "can't happen" by
  //    construction — checked anyway so --execute can never hit a constraint
  //    error mid-write.
  const customerIds = new Set<string>()
  const customerEmails = new Set<string>()
  for (const customer of customers) {
    if (customerIds.has(customer.id)) {
      issues.push({
        severity: 'error',
        rowNumber: null,
        field: 'customers.id',
        message: `internal: duplicate planned customer id ${customer.id}`,
      })
    }
    customerIds.add(customer.id)
    const emailLower = customer.email.toLowerCase()
    if (customerEmails.has(emailLower)) {
      issues.push({
        severity: 'error',
        rowNumber: null,
        field: 'customers.email',
        message: `internal: duplicate planned customer email ${JSON.stringify(customer.email)} (citext unique index)`,
      })
    }
    customerEmails.add(emailLower)
  }
  for (const job of jobs) {
    if (!customerIds.has(job.customer_id)) {
      issues.push({
        severity: 'error',
        rowNumber: job.legacy.rowNumber,
        field: 'customer_id',
        message: `internal: job ${job.id} references unplanned customer ${job.customer_id}`,
      })
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    totalSheetRows: rows.length,
    jobs,
    customers,
    issues,
    duplicateJobIds,
    mintedJobIds,
    excludedRowNumbers,
  }
}

// ---------------------------------------------------------------------------
// Audit tab → activities. One row of 'Audit!A:G' (timestamp, actor, action,
// target, before, after, notes) becomes one activities insert with its
// ORIGINAL timestamp; unparseable timestamps skip the row with an issue.
// ---------------------------------------------------------------------------

export interface PlannedActivity {
  at: string
  actor: string
  action: string
  target: string
  before: string | null
  after: string | null
  notes: string | null
  job_id: string | null
  data: Record<string, unknown> | null
}

function tryParseJsonContainer(cell: string): unknown {
  const trimmed = cell.trim()
  if (trimmed === '' || (trimmed[0] !== '{' && trimmed[0] !== '[')) return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}

export function planAuditActivity(
  rowNumber: number,
  cells: string[],
): { activity: PlannedActivity | null; issue?: MigrationIssue } {
  const [timestamp = '', actor = '', action = '', target = '', before = '', after = '', notes = ''] = cells
  const at = parseSheetTimestamp(timestamp)
  if (at.value === null) {
    return {
      activity: null,
      issue: {
        severity: 'warning',
        rowNumber,
        field: 'timestamp',
        message:
          at.issue === undefined
            ? 'Audit row skipped: empty timestamp'
            : `Audit row skipped: ${at.issue}`,
      },
    }
  }

  // Opportunistic JSON.parse of before/after into data (objects/arrays only)
  // so Stripe IDs are queryable before Phase D/F — same convention as
  // lib/data/pg/audit.ts applies to new writes.
  const data: Record<string, unknown> = {}
  const beforeJson = tryParseJsonContainer(before)
  if (beforeJson !== undefined) data.before = beforeJson
  const afterJson = tryParseJsonContainer(after)
  if (afterJson !== undefined) data.after = afterJson

  const targetTrim = target.trim()
  return {
    activity: {
      at: at.value,
      actor,
      action,
      target,
      before: before === '' ? null : before,
      after: after === '' ? null : after,
      notes: notes === '' ? null : notes,
      job_id: isUuid(targetTrim) ? targetTrim.toLowerCase() : null,
      data: Object.keys(data).length > 0 ? data : null,
    },
  }
}

// ---------------------------------------------------------------------------
// --verify support: render the planned job as the ContactRow cell strings
// lib/data/pg/mappers.ts toContactRow() must produce after migration, and
// diff field-by-field.
// ---------------------------------------------------------------------------

// hours_to_first_touch is excluded from verification: Postgres generates it
// from (first_touch_sent_at - submitted_at); the sheet cell was a manual
// ARRAYFORMULA that may disagree in formatting. The raw cell is preserved in
// legacy.sheetRow.
export const VERIFY_SKIPPED_FIELDS: ReadonlySet<SheetColumn> = new Set<SheetColumn>([
  'hours_to_first_touch',
])

function numberCell(value: number | null): string {
  return value === null ? '' : String(value)
}

function boolCell(value: boolean): string {
  return value ? 'true' : ''
}

function timestampCell(value: string | null): string {
  return value ?? ''
}

export function renderPlannedJobAsContactRow(job: PlannedJob): Record<SheetColumn, string> {
  return {
    submitted_at: job.submitted_at,
    name: job.name,
    phone: job.phone,
    email: job.email,
    address: job.address,
    service_type: job.service_type,
    preferred_date: job.preferred_date ?? '',
    description: job.description,
    referral_source: job.referral_source,
    status: job.status,
    complete_date: timestampCell(job.complete_date),
    review_sent_at: timestampCell(job.review_sent_at),
    review_send_count: numberCell(job.review_send_count),
    review_received: boolCell(job.review_received),
    seasonal_nudge_last_sent: timestampCell(job.seasonal_nudge_last_sent),
    opt_out: boolCell(job.opt_out),
    first_touch_sent_at: timestampCell(job.first_touch_sent_at),
    hours_to_first_touch: '', // generated — never compared (VERIFY_SKIPPED_FIELDS)
    utm_source: job.utm_source,
    job_id: job.id,
    stripe_customer_id: job.stripe_customer_id,
    stripe_payment_method_id: job.stripe_payment_method_id,
    deposit_paid_cents: numberCell(job.deposit_paid_cents),
    balance_owed_cents: numberCell(job.balance_owed_cents),
    service_categories: job.service_categories.join(','),
    property_type: job.property_type,
    urgency: job.urgency,
    best_contact_time: job.best_contact_time,
    best_contact_method: job.best_contact_method,
    photo_urls: job.photo_urls.join(','),
    is_returning_customer: boolCell(job.is_returning_customer),
    prior_job_count: numberCell(job.prior_job_count),
    dispatch_status: job.dispatch_status,
    dispatch_decision: job.dispatch_decision,
    dispatch_decided_at: timestampCell(job.dispatch_decided_at),
    telegram_message_id: job.telegram_message_id,
  }
}

export interface FieldDiff {
  field: SheetColumn
  expected: string
  actual: string
}

export function diffContactRows(
  expected: Record<SheetColumn, string>,
  actual: Partial<Record<SheetColumn, string>>,
): FieldDiff[] {
  const diffs: FieldDiff[] = []
  for (const field of SHEET_HEADERS) {
    if (VERIFY_SKIPPED_FIELDS.has(field)) continue
    const expectedCell = expected[field]
    const actualCell = actual[field] ?? ''
    if (expectedCell !== actualCell) {
      diffs.push({ field, expected: expectedCell, actual: actualCell })
    }
  }
  return diffs
}
