import type { ContactRow, ContactRowPartial, SheetColumn } from '@/lib/sheet/repo'

// Bidirectional mapping between public.jobs rows (db/schema.sql) and the
// all-strings ContactRow contract. PARITY-CRITICAL: every convention here is
// covered by round-trip unit tests — pg output must be byte-identical to what
// the sheet layer produced, because queries.ts/pipeline compare ISO timestamps
// lexicographically and admin/cron code does `(v || '').trim().toLowerCase()`
// style checks on raw cell strings.
//
// Conventions (docs/stage-13-postgres-design.md, "Mapper conventions"):
// - booleans: true ↔ 'true', false ↔ ''
// - numerics (ALL counts/cents): NULL ↔ '', n ↔ String(n) — preserves '' ≠ '0'
// - timestamps: read is normalized via new Date(v).toISOString() so
//   PostgREST's microsecond/+00:00 format never escapes; write maps '' ↔ NULL
// - preferred_date: date ↔ 'YYYY-MM-DD'; NULL ↔ ''
// - arrays: text[] ↔ comma-joined; {} ↔ ''
// - hours_to_first_touch: generated column — mapped on READ only, the toDb
//   mappers never emit it
// - email: trimmed at the write boundary (citext makes .eq() equal the
//   sheet's trim+lowercase matching)
// - every absent/null DB value coerces to '' on read — no null/undefined
//   ever crosses the repo boundary

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

// A public.jobs row as returned by PostgREST/supabase-js.
export interface DbJob {
  id: string
  customer_id: string
  created_at: string
  updated_at: string
  submitted_at: string
  name: string
  phone: string
  email: string
  address: string
  service_type: string
  preferred_date: string | null // 'YYYY-MM-DD'
  description: string
  referral_source: string
  status: string
  complete_date: string | null
  review_sent_at: string | null
  review_send_count: number | null
  review_received: boolean
  seasonal_nudge_last_sent: string | null
  opt_out: boolean
  first_touch_sent_at: string | null
  hours_to_first_touch: number | null // generated, read-only
  utm_source: string
  stripe_customer_id: string
  stripe_payment_method_id: string
  deposit_paid_cents: number | null
  balance_owed_cents: number | null
  service_categories: string[]
  property_type: string
  urgency: string
  best_contact_time: string
  best_contact_method: string
  photo_urls: string[]
  is_returning_customer: boolean
  prior_job_count: number | null
  dispatch_status: string
  dispatch_decision: string
  dispatch_decided_at: string | null
  telegram_message_id: string
  legacy: unknown
  anonymized_at: string | null
}

// Columns the app writes. Excludes: hours_to_first_touch (generated),
// customer_id / legacy / anonymized_at (owned by pg/repo.ts and the
// migration), created_at / updated_at (DB defaults + trigger).
export type DbJobInsert = {
  id: string
  submitted_at: string | null
  name: string
  phone: string
  email: string
  address: string
  service_type: string
  preferred_date: string | null
  description: string
  referral_source: string
  status: string
  complete_date: string | null
  review_sent_at: string | null
  review_send_count: number | null
  review_received: boolean
  seasonal_nudge_last_sent: string | null
  opt_out: boolean
  first_touch_sent_at: string | null
  utm_source: string
  stripe_customer_id: string
  stripe_payment_method_id: string
  deposit_paid_cents: number | null
  balance_owed_cents: number | null
  service_categories: string[]
  property_type: string
  urgency: string
  best_contact_time: string
  best_contact_method: string
  photo_urls: string[]
  is_returning_customer: boolean
  prior_job_count: number | null
  dispatch_status: string
  dispatch_decision: string
  dispatch_decided_at: string | null
  telegram_message_id: string
}

export type DbJobUpdate = Partial<DbJobInsert>

type DbValue = string | string[] | number | boolean | null

// ---------------------------------------------------------------------------
// Field name map — sheet column ↔ db column. They are identical snake_case
// except for the single rename job_id ↔ id (jobs.id IS the legacy job_id).
// Declared as an exhaustive Record so adding a SHEET_HEADERS column without
// updating this file is a compile error.
// ---------------------------------------------------------------------------

export type DbJobColumn = Exclude<SheetColumn, 'job_id'> | 'id'

export const SHEET_FIELD_TO_DB_COLUMN: Record<SheetColumn, DbJobColumn> = {
  submitted_at: 'submitted_at',
  name: 'name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  service_type: 'service_type',
  preferred_date: 'preferred_date',
  description: 'description',
  referral_source: 'referral_source',
  status: 'status',
  complete_date: 'complete_date',
  review_sent_at: 'review_sent_at',
  review_send_count: 'review_send_count',
  review_received: 'review_received',
  seasonal_nudge_last_sent: 'seasonal_nudge_last_sent',
  opt_out: 'opt_out',
  first_touch_sent_at: 'first_touch_sent_at',
  hours_to_first_touch: 'hours_to_first_touch',
  utm_source: 'utm_source',
  job_id: 'id', // the one rename
  stripe_customer_id: 'stripe_customer_id',
  stripe_payment_method_id: 'stripe_payment_method_id',
  deposit_paid_cents: 'deposit_paid_cents',
  balance_owed_cents: 'balance_owed_cents',
  service_categories: 'service_categories',
  property_type: 'property_type',
  urgency: 'urgency',
  best_contact_time: 'best_contact_time',
  best_contact_method: 'best_contact_method',
  photo_urls: 'photo_urls',
  is_returning_customer: 'is_returning_customer',
  prior_job_count: 'prior_job_count',
  dispatch_status: 'dispatch_status',
  dispatch_decision: 'dispatch_decision',
  dispatch_decided_at: 'dispatch_decided_at',
  telegram_message_id: 'telegram_message_id',
}

export const DB_COLUMN_TO_SHEET_FIELD: Record<DbJobColumn, SheetColumn> = Object.fromEntries(
  (Object.entries(SHEET_FIELD_TO_DB_COLUMN) as [SheetColumn, DbJobColumn][]).map(
    ([sheetField, dbColumn]) => [dbColumn, sheetField],
  ),
) as Record<DbJobColumn, SheetColumn>

// How each sheet field converts. Exhaustive for the same compile-time
// guarantee as the name map.
type FieldKind = 'text' | 'timestamp' | 'date' | 'boolean' | 'integer' | 'array' | 'generated'

const FIELD_KIND: Record<SheetColumn, FieldKind> = {
  submitted_at: 'timestamp',
  name: 'text',
  phone: 'text',
  email: 'text',
  address: 'text',
  service_type: 'text',
  preferred_date: 'date',
  description: 'text',
  referral_source: 'text',
  status: 'text',
  complete_date: 'timestamp',
  review_sent_at: 'timestamp',
  review_send_count: 'integer',
  review_received: 'boolean',
  seasonal_nudge_last_sent: 'timestamp',
  opt_out: 'boolean',
  first_touch_sent_at: 'timestamp',
  hours_to_first_touch: 'generated',
  utm_source: 'text',
  job_id: 'text',
  stripe_customer_id: 'text',
  stripe_payment_method_id: 'text',
  deposit_paid_cents: 'integer',
  balance_owed_cents: 'integer',
  service_categories: 'array',
  property_type: 'text',
  urgency: 'text',
  best_contact_time: 'text',
  best_contact_method: 'text',
  photo_urls: 'array',
  is_returning_customer: 'boolean',
  prior_job_count: 'integer',
  dispatch_status: 'text',
  dispatch_decision: 'text',
  dispatch_decided_at: 'timestamp',
  telegram_message_id: 'text',
}

// ---------------------------------------------------------------------------
// uuid shape — accepts any version (runtime ids are v4; the migration mints
// deterministic v5 ids for legacy rows). pg/repo.ts gates on this so non-UUID
// jobIds return null / {updated:false} like the sheet did, never a 22P02 throw.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

// ---------------------------------------------------------------------------
// DB → cell (read side)
// ---------------------------------------------------------------------------

// Normalize through the JS Date constructor so PostgREST's
// '2026-06-12 14:03:22.123456+00:00' renders as the exact
// '2026-06-12T14:03:22.123Z' shape the sheet stored. Lexicographic
// comparisons downstream depend on this being byte-identical.
function cellFromTimestamp(value: string | null | undefined): string {
  if (!value) return ''
  return new Date(value).toISOString()
}

function cellFromDate(value: string | null | undefined): string {
  return value ?? '' // date columns already come back as 'YYYY-MM-DD'
}

function cellFromNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function cellFromBool(value: boolean | null | undefined): string {
  return value ? 'true' : ''
}

function cellFromArray(value: string[] | null | undefined): string {
  return (value ?? []).join(',') // {} → ''
}

function cellFromText(value: string | null | undefined): string {
  return value ?? ''
}

// ---------------------------------------------------------------------------
// Cell → DB (write side)
// ---------------------------------------------------------------------------

function timestampFromCell(cell: string | undefined): string | null {
  const value = cell ?? ''
  return value === '' ? null : value
}

function dateFromCell(cell: string | undefined): string | null {
  const value = cell ?? ''
  return value === '' ? null : value
}

function intFromCell(field: SheetColumn, cell: string | undefined): number | null {
  const value = cell ?? ''
  if (value === '') return null
  const n = Number(value)
  if (!Number.isInteger(n)) {
    throw new Error(`mappers: ${field} expected an integer string, got ${JSON.stringify(cell)}`)
  }
  return n
}

// App code only ever writes 'true' or '', but readers everywhere check
// trim().toLowerCase() === 'true', so we accept the same shapes they do.
function boolFromCell(cell: string | undefined): boolean {
  return (cell ?? '').trim().toLowerCase() === 'true'
}

function arrayFromCell(cell: string | undefined): string[] {
  const value = cell ?? ''
  if (value === '') return []
  return value.split(',') // sheet cells were comma-joined with no escaping
}

function toDbValue(field: SheetColumn, cell: string | undefined): DbValue {
  switch (FIELD_KIND[field]) {
    case 'text': {
      const value = cell ?? ''
      // email trimmed at the write boundary; id trimmed to match the sheet's
      // trimmed job_id comparisons
      return field === 'email' || field === 'job_id' ? value.trim() : value
    }
    case 'timestamp':
      return timestampFromCell(cell)
    case 'date':
      return dateFromCell(cell)
    case 'boolean':
      return boolFromCell(cell)
    case 'integer':
      return intFromCell(field, cell)
    case 'array':
      return arrayFromCell(cell)
    case 'generated':
      throw new Error(`mappers: ${field} is a generated column and must never be written`)
  }
}

// ---------------------------------------------------------------------------
// Public mappers
// ---------------------------------------------------------------------------

export function toContactRow(dbRow: DbJob): ContactRow {
  return {
    submitted_at: cellFromTimestamp(dbRow.submitted_at),
    name: cellFromText(dbRow.name),
    phone: cellFromText(dbRow.phone),
    email: cellFromText(dbRow.email),
    address: cellFromText(dbRow.address),
    service_type: cellFromText(dbRow.service_type),
    preferred_date: cellFromDate(dbRow.preferred_date),
    description: cellFromText(dbRow.description),
    referral_source: cellFromText(dbRow.referral_source),
    status: cellFromText(dbRow.status),
    complete_date: cellFromTimestamp(dbRow.complete_date),
    review_sent_at: cellFromTimestamp(dbRow.review_sent_at),
    review_send_count: cellFromNumber(dbRow.review_send_count),
    review_received: cellFromBool(dbRow.review_received),
    seasonal_nudge_last_sent: cellFromTimestamp(dbRow.seasonal_nudge_last_sent),
    opt_out: cellFromBool(dbRow.opt_out),
    first_touch_sent_at: cellFromTimestamp(dbRow.first_touch_sent_at),
    hours_to_first_touch: cellFromNumber(dbRow.hours_to_first_touch), // READ only
    utm_source: cellFromText(dbRow.utm_source),
    job_id: cellFromText(dbRow.id),
    stripe_customer_id: cellFromText(dbRow.stripe_customer_id),
    stripe_payment_method_id: cellFromText(dbRow.stripe_payment_method_id),
    deposit_paid_cents: cellFromNumber(dbRow.deposit_paid_cents),
    balance_owed_cents: cellFromNumber(dbRow.balance_owed_cents),
    service_categories: cellFromArray(dbRow.service_categories),
    property_type: cellFromText(dbRow.property_type),
    urgency: cellFromText(dbRow.urgency),
    best_contact_time: cellFromText(dbRow.best_contact_time),
    best_contact_method: cellFromText(dbRow.best_contact_method),
    photo_urls: cellFromArray(dbRow.photo_urls),
    is_returning_customer: cellFromBool(dbRow.is_returning_customer),
    prior_job_count: cellFromNumber(dbRow.prior_job_count),
    dispatch_status: cellFromText(dbRow.dispatch_status),
    dispatch_decision: cellFromText(dbRow.dispatch_decision),
    dispatch_decided_at: cellFromTimestamp(dbRow.dispatch_decided_at),
    telegram_message_id: cellFromText(dbRow.telegram_message_id),
  }
}

// Maps a full ContactRow to an insertable jobs row. Mirrors the sheet append's
// `row[header] ?? ''` semantics: absent optionals become their cleared DB
// value ('' / NULL / false / {}). Does NOT include customer_id — pg/repo.ts
// owns the customer upsert and spreads it in.
export function toDbInsert(row: ContactRow): DbJobInsert {
  const id = (row.job_id ?? '').trim()
  if (!isUuid(id)) {
    // jobs.id has no DB default; the contact route always generates a UUID.
    // Reaching this is a programmer error, not a data condition.
    throw new Error(`mappers: toDbInsert requires a UUID job_id, got ${JSON.stringify(row.job_id)}`)
  }
  return {
    id,
    submitted_at: timestampFromCell(row.submitted_at),
    name: row.name ?? '',
    phone: row.phone ?? '',
    email: (row.email ?? '').trim(),
    address: row.address ?? '',
    service_type: row.service_type ?? '',
    preferred_date: dateFromCell(row.preferred_date),
    description: row.description ?? '',
    referral_source: row.referral_source ?? '',
    status: row.status ?? '',
    complete_date: timestampFromCell(row.complete_date),
    review_sent_at: timestampFromCell(row.review_sent_at),
    review_send_count: intFromCell('review_send_count', row.review_send_count),
    review_received: boolFromCell(row.review_received),
    seasonal_nudge_last_sent: timestampFromCell(row.seasonal_nudge_last_sent),
    opt_out: boolFromCell(row.opt_out),
    first_touch_sent_at: timestampFromCell(row.first_touch_sent_at),
    // hours_to_first_touch intentionally absent — generated column
    utm_source: row.utm_source ?? '',
    stripe_customer_id: row.stripe_customer_id ?? '',
    stripe_payment_method_id: row.stripe_payment_method_id ?? '',
    deposit_paid_cents: intFromCell('deposit_paid_cents', row.deposit_paid_cents),
    balance_owed_cents: intFromCell('balance_owed_cents', row.balance_owed_cents),
    service_categories: arrayFromCell(row.service_categories),
    property_type: row.property_type ?? '',
    urgency: row.urgency ?? '',
    best_contact_time: row.best_contact_time ?? '',
    best_contact_method: row.best_contact_method ?? '',
    photo_urls: arrayFromCell(row.photo_urls),
    is_returning_customer: boolFromCell(row.is_returning_customer),
    prior_job_count: intFromCell('prior_job_count', row.prior_job_count),
    dispatch_status: row.dispatch_status ?? '',
    dispatch_decision: row.dispatch_decision ?? '',
    dispatch_decided_at: timestampFromCell(row.dispatch_decided_at),
    telegram_message_id: row.telegram_message_id ?? '',
  }
}

// Maps a sparse update. Sheet parity: an explicitly-undefined value cleared
// the cell, so undefined maps to the cleared DB value, not "skip".
// hours_to_first_touch is silently dropped (generated — the DB recomputes it
// from first_touch_sent_at; no app code ever wrote it on the sheet either).
export function toDbUpdate(partial: ContactRowPartial): DbJobUpdate {
  const update: Record<string, DbValue> = {}
  for (const key of Object.keys(partial) as SheetColumn[]) {
    if (!(key in SHEET_FIELD_TO_DB_COLUMN)) {
      // The sheet layer surfaced unknown keys as a malformed-range API error;
      // fail loud here too rather than sending PostgREST an unknown column.
      throw new Error(`mappers: toDbUpdate received unknown ContactRow field ${JSON.stringify(key)}`)
    }
    if (key === 'hours_to_first_touch') continue
    update[SHEET_FIELD_TO_DB_COLUMN[key]] = toDbValue(key, partial[key])
  }
  return update as DbJobUpdate
}
