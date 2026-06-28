import { randomUUID } from 'node:crypto'
import { getSupabaseClient } from '@/lib/data/pg/client'
import { isUuid, toContactRow, type DbJob } from '@/lib/data/pg/mappers'
import type { JobRow } from '@/lib/sheet/queries'

// PII sentinel, matching app/admin/data-requests/actions.ts + pg/repo.ts.
const REDACTED = '[REDACTED]'

// Postgres implementation of the Stage 14 (Phase B1) CRM read surface — the
// customer list, profiles, and dashboard stats the admin CRM is built from.
// See docs/stage-14-crm-interface-design.md ("B1 — data layer").
//
// POSTGRES-ONLY: these surfaces have no sheet counterpart. lib/data/index.ts
// returns empty/null in sheet mode and the pages render an honest "available
// on Postgres" notice (crmEnabled()). There is no sheet-parity work here.
//
// ALL-STRINGS BOUNDARY DISCIPLINE (Phase A rule, lib/data/pg/mappers.ts): no
// null/undefined crosses this boundary. Money/counts are cent-STRINGS via the
// number->string convention; timestamps are ISO-normalized through
// new Date(v).toISOString(); absent text coerces to ''. We never return Date
// objects or numbers for money.

// Mirrors lib/data/pg/queries.ts: PostgREST caps a response at 1000 rows, so
// every multi-row read loops .range() with a stable order until a short page
// returns.
const PAGE_SIZE = 1000

// ---------------------------------------------------------------------------
// Types — the CRM read surface (re-exported via lib/data/index.ts).
// ---------------------------------------------------------------------------

// One row of customer_summary, coerced to the all-strings discipline. Money
// (depositsCollectedCents) and counts (jobCount, propertyCount) are STRINGS;
// dates are ISO or ''. `anonymized` is the boolean derived from
// customers.anonymized_at (a redacted customer's PII is sentinel/REDACTED).
export interface CustomerSummary {
  id: string
  name: string
  phone: string
  email: string
  notes: string
  jobCount: string
  lastJobAt: string
  firstJobAt: string
  depositsCollectedCents: string
  propertyCount: string
  anonymized: boolean
}

// A customer's derived "property": their jobs grouped by normalized address
// (trim/lowercase/collapse-whitespace). Landlords have one email, many
// addresses. `address` is the original-cased representative (first seen).
export interface CustomerProperty {
  address: string
  jobCount: string
  lastJobAt: string
}

// A full customer profile: the summary row + that customer's jobs (mapped
// through toContactRow, so every JobRow obeys the all-strings discipline) +
// the in-memory properties rollup.
export interface CustomerDetail extends CustomerSummary {
  jobs: JobRow[]
  properties: CustomerProperty[]
}

// Dashboard counts off the view. Kept simple (totalCustomers, totalJobs) per
// the Stage 14 spec; richer breakdowns arrive with later phases.
export interface CustomerStats {
  totalCustomers: string
  totalJobs: string
}

// A customer_summary row as returned by PostgREST. count()/sum() come back as
// numbers (or null for the date aggregates over a customer with no jobs).
interface DbCustomerSummary {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  anonymized_at: string | null
  created_at: string | null
  job_count: number | null
  last_job_at: string | null
  first_job_at: string | null
  deposits_collected_cents: number | null
  property_count: number | null
}

// ---------------------------------------------------------------------------
// Coercion helpers — same conventions as lib/data/pg/mappers.ts, kept local so
// this surface (which reads the view, not the jobs table) doesn't reach into
// the mapper's private cell-* functions.
// ---------------------------------------------------------------------------

function strFromText(value: string | null | undefined): string {
  return value ?? ''
}

function strFromNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

// Mirrors mappers.cellFromTimestamp: normalize through the JS Date constructor
// so PostgREST's microsecond/+00:00 shape renders as the exact ISO the rest of
// the app compares lexicographically; empty/null -> ''.
function strFromTimestamp(value: string | null | undefined): string {
  if (!value) return ''
  return new Date(value).toISOString()
}

function mapSummary(row: DbCustomerSummary): CustomerSummary {
  return {
    id: strFromText(row.id),
    name: strFromText(row.name),
    phone: strFromText(row.phone),
    email: strFromText(row.email),
    notes: strFromText(row.notes),
    jobCount: strFromNumber(row.job_count),
    lastJobAt: strFromTimestamp(row.last_job_at),
    firstJobAt: strFromTimestamp(row.first_job_at),
    // coalesce(sum(...),0) in the view means this is always a number, but the
    // number->string convention still applies (cent-STRING, never a number).
    depositsCollectedCents: strFromNumber(row.deposits_collected_cents),
    propertyCount: strFromNumber(row.property_count),
    anonymized: row.anonymized_at != null,
  }
}

const SUMMARY_COLUMNS =
  'id,name,phone,email,notes,anonymized_at,created_at,job_count,last_job_at,first_job_at,deposits_collected_cents,property_count'

// ---------------------------------------------------------------------------
// Properties derivation — group a customer's jobs by normalized address. Small
// N (one customer's jobs), so an in-memory reduce is fine; no schema change.
// ---------------------------------------------------------------------------

// trim, lowercase, collapse internal whitespace runs to a single space — the
// grouping key. A blank address collapses to '' and is skipped (no property).
function normalizeAddress(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, ' ')
}

function deriveProperties(jobs: JobRow[]): CustomerProperty[] {
  // Map preserves insertion order, so the representative address is the first
  // job seen for that normalized key, and the iteration order is first-seen.
  const groups = new Map<string, { address: string; count: number; lastJobAt: string }>()
  for (const job of jobs) {
    const key = normalizeAddress(job.address)
    if (key === '') continue
    const existing = groups.get(key)
    if (existing) {
      existing.count += 1
      // submitted_at is an ISO string ('' when absent); lexicographic compare
      // gives the most-recent non-empty value.
      if (job.submitted_at > existing.lastJobAt) existing.lastJobAt = job.submitted_at
    } else {
      groups.set(key, { address: job.address, count: 1, lastJobAt: job.submitted_at })
    }
  }
  return Array.from(groups.values()).map((g) => ({
    address: g.address,
    jobCount: String(g.count),
    lastJobAt: g.lastJobAt,
  }))
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

// Paginated select from customer_summary, ordered by last_job_at desc with
// nulls last (customers with zero jobs sort to the bottom). id is the stable
// tiebreak so the page boundaries are deterministic.
export async function listCustomers(): Promise<CustomerSummary[]> {
  const client = getSupabaseClient()
  const rows: DbCustomerSummary[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await client
      .from('customer_summary')
      .select(SUMMARY_COLUMNS)
      .order('last_job_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`pg/customers: listCustomers page read failed: ${error.message}`)
    const page = (data ?? []) as unknown as DbCustomerSummary[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows.map(mapSummary)
}

// One customer_summary row + that customer's jobs + the derived properties.
// Non-UUID id returns null without querying (parity with the repo's UUID gate
// — a uuid-typed .eq() would throw 22P02 on garbage input).
export async function getCustomerById(id: string): Promise<CustomerDetail | null> {
  if (!isUuid(id)) return null
  const client = getSupabaseClient()

  const { data: summaryRow, error: summaryError } = await client
    .from('customer_summary')
    .select(SUMMARY_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (summaryError) {
    throw new Error(`pg/customers: getCustomerById summary read failed: ${summaryError.message}`)
  }
  if (!summaryRow) return null

  // The customer's jobs, paginated, oldest-first (append order — same stable
  // order pg/queries.ts uses) so JobRow ordering is deterministic.
  const jobRows: DbJob[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await client
      .from('jobs')
      .select('*')
      .eq('customer_id', id)
      .order('submitted_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      throw new Error(`pg/customers: getCustomerById jobs read failed: ${error.message}`)
    }
    const page = (data ?? []) as DbJob[]
    jobRows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  // rowNumber is synthetic in pg (sheet row numbers don't exist); callers use
  // it only as a React key / log label — index+2 mirrors pg/queries.toJobRow.
  const jobs: JobRow[] = jobRows.map((dbRow, index) => ({
    ...toContactRow(dbRow),
    rowNumber: index + 2,
  }))

  // Read-side anonymization guard: getCustomerById aggregates jobs by
  // customer_id, but the deletion path (anonymizeCustomer) redacts jobs by
  // EMAIL match. Today job.email == customer.email for every job under a
  // customer, so the sets coincide — but if a customer_id ever owns a job the
  // email redaction missed (a future email-edit / merge), this profile must
  // still never out-render the deletion. When the customer is anonymized, blank
  // the joined jobs' PII at the boundary regardless of each row's own state.
  const summary = mapSummary(summaryRow as unknown as DbCustomerSummary)
  const safeJobs: JobRow[] = summary.anonymized
    ? jobs.map((j) => ({
        ...j,
        name: REDACTED,
        phone: REDACTED,
        email: REDACTED,
        address: REDACTED,
        description: REDACTED,
      }))
    : jobs

  return {
    ...summary,
    jobs: safeJobs,
    properties: deriveProperties(safeJobs),
  }
}

// Dashboard counts off the view. totalCustomers = row count of the view;
// totalJobs = sum of job_count. Both returned as STRINGS.
export async function getCustomerStats(): Promise<CustomerStats> {
  const client = getSupabaseClient()

  const { count, error: countError } = await client
    .from('customer_summary')
    .select('id', { count: 'exact', head: true })
  if (countError) {
    throw new Error(`pg/customers: getCustomerStats customer count failed: ${countError.message}`)
  }

  // job_count is per-customer; sum it across the view for the total. Paginate
  // like the other reads so a >1000-customer base still totals correctly.
  let totalJobs = 0
  let offset = 0
  for (;;) {
    const { data, error } = await client
      .from('customer_summary')
      .select('job_count')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      throw new Error(`pg/customers: getCustomerStats job_count read failed: ${error.message}`)
    }
    const page = (data ?? []) as { job_count: number | null }[]
    for (const r of page) totalJobs += r.job_count ?? 0
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return {
    totalCustomers: String(count ?? 0),
    totalJobs: String(totalJobs),
  }
}

// ---------------------------------------------------------------------------
// Write — the one append B1 owns (standing notes). Non-UUID id is a graceful
// no-op (parity with the repo's UUID gate). Returns { updated } so the caller
// can surface a result; a valid-but-absent UUID updates zero rows -> false.
// ---------------------------------------------------------------------------

export async function updateCustomerNotes(
  id: string,
  notes: string,
): Promise<{ updated: boolean }> {
  if (!isUuid(id)) return { updated: false }
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('customers')
    .update({ notes: notes ?? '' })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(`pg/customers: updateCustomerNotes update failed: ${error.message}`)
  return { updated: (data?.length ?? 0) > 0 }
}

// One customer row by email. citext .eq() makes the match case-insensitive,
// mirroring the customers_email_uniq index + the sheet's trim+lowercase email
// matching. Empty email -> null WITHOUT querying (a blank lookup found nothing;
// it must never collapse onto the unknown:/redacted: sentinels). Used by the
// manual "Add customer" path for duplicate detection and to resolve the id of a
// customer just upserted via appendContactRow.
export async function findCustomerByEmail(email: string): Promise<{ id: string } | null> {
  const trimmed = (email ?? '').trim()
  if (trimmed === '') return null
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('customers')
    .select('id')
    .eq('email', trimmed)
    .maybeSingle()
  if (error) throw new Error(`pg/customers: findCustomerByEmail query failed: ${error.message}`)
  return data ? { id: (data as { id: string }).id } : null
}

// Insert a STANDALONE customer (no job) — the genuinely-new write the manual
// "Add customer" surface needs. appendContactRow (pg/repo.ts) only ever creates
// a customer as a SIDE EFFECT of a job; this is the bare-customer primitive.
// name/phone/notes default to '' (the table defaults); email is required by the
// schema (NOT NULL citext) — an empty email gets the migration's
// 'unknown:<uuid>' sentinel so distinct email-less manual adds never collapse
// onto one shared row. A citext-unique (23505) conflict returns { duplicate }
// rather than throwing, so the caller can point at the existing record.
export async function insertCustomer(input: {
  name?: string
  phone?: string
  email?: string
  notes?: string
}): Promise<{ id: string } | { duplicate: true }> {
  const client = getSupabaseClient()
  const email = (input.email ?? '').trim()
  const payload = {
    email: email === '' ? `unknown:${randomUUID()}` : email,
    name: input.name ?? '',
    phone: input.phone ?? '',
    notes: input.notes ?? '',
  }
  const { data, error } = await client
    .from('customers')
    .insert(payload)
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') return { duplicate: true }
    throw new Error(`pg/customers: insertCustomer insert failed: ${error.message}`)
  }
  return { id: (data as { id: string }).id }
}
