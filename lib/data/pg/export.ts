import { getSupabaseClient } from '@/lib/data/pg/client'

// Postgres implementation of lib/sheet/export.ts (Stage 13): exports the
// three populated tables (customers, jobs, activities) as RFC-4180 CSVs for
// the daily backup email. Same return shape as the sheet version so the
// backup-sheet cron only branches on subject/body copy.
//
// Conventions:
// - Row 1 of each CSV is the column-name header (so `rowCount` includes the
//   header, matching the sheet's used-range semantics where row 1 was the
//   header; an empty table still exports its header row with rowCount 1).
// - Stable order + .range() pagination (PAGE_SIZE 1000) per the design's
//   pagination contract — PostgREST caps responses, large tables must loop.
// - Cell rendering: NULL -> '', booleans -> 'true'/'false', numbers ->
//   String(n), text[] and jsonb -> JSON.stringify (lossless + parseable;
//   restore via the Supabase CSV importer is a manual/scripted step anyway).

const PAGE_SIZE = 1000

interface TableSpec {
  name: string
  columns: string[]
  // Stable ordering for deterministic pagination/output.
  orderBy: { column: string; ascending: boolean }[]
}

const TABLES: TableSpec[] = [
  {
    name: 'customers',
    columns: [
      'id',
      'created_at',
      'updated_at',
      'name',
      'phone',
      'email',
      'notes',
      'anonymized_at',
    ],
    orderBy: [
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ],
  },
  {
    name: 'jobs',
    // db/schema.sql column order.
    columns: [
      'id',
      'customer_id',
      'created_at',
      'updated_at',
      'submitted_at',
      'name',
      'phone',
      'email',
      'address',
      'service_type',
      'preferred_date',
      'description',
      'referral_source',
      'status',
      'complete_date',
      'review_sent_at',
      'review_send_count',
      'review_received',
      'seasonal_nudge_last_sent',
      'opt_out',
      'first_touch_sent_at',
      'hours_to_first_touch',
      'utm_source',
      'stripe_customer_id',
      'stripe_payment_method_id',
      'deposit_paid_cents',
      'balance_owed_cents',
      'service_categories',
      'property_type',
      'urgency',
      'best_contact_time',
      'best_contact_method',
      'photo_urls',
      'is_returning_customer',
      'prior_job_count',
      'dispatch_status',
      'dispatch_decision',
      'dispatch_decided_at',
      'telegram_message_id',
      'legacy',
      'anonymized_at',
    ],
    orderBy: [
      { column: 'submitted_at', ascending: true },
      { column: 'id', ascending: true },
    ],
  },
  {
    name: 'activities',
    columns: ['id', 'at', 'actor', 'action', 'target', 'before', 'after', 'notes', 'job_id', 'data'],
    // Identity PK == append order.
    orderBy: [{ column: 'id', ascending: true }],
  },
]

// RFC 4180 CSV escaping, copied from lib/sheet/export.ts (NOT imported — the
// sheet module must stay loadable/retirable independently). Wraps in quotes
// if the cell contains a comma, double-quote, newline, or carriage return.
// Doubles any inner quotes. Rows joined with CRLF, no trailing newline.
function escapeCsvCell(value: string): string {
  if (value === '') return ''
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function rowsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return JSON.stringify(value) // text[] arrays and jsonb (legacy, data)
}

async function fetchAllRows(spec: TableSpec): Promise<Record<string, unknown>[]> {
  const client = getSupabaseClient()
  const rows: Record<string, unknown>[] = []
  let offset = 0
  for (;;) {
    let query = client.from(spec.name).select(spec.columns.join(','))
    for (const order of spec.orderBy) {
      query = query.order(order.column, { ascending: order.ascending })
    }
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`pg/export: ${spec.name} page read failed: ${error.message}`)
    const page = (data ?? []) as unknown as Record<string, unknown>[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

export async function exportAllTabsCsv(): Promise<
  { tabName: string; csv: string; rowCount: number }[]
> {
  const out: { tabName: string; csv: string; rowCount: number }[] = []
  for (const spec of TABLES) {
    const dbRows = await fetchAllRows(spec)
    const allRows: string[][] = [
      [...spec.columns],
      ...dbRows.map((row) => spec.columns.map((column) => cellToString(row[column]))),
    ]
    out.push({
      tabName: spec.name,
      csv: rowsToCsv(allRows),
      rowCount: allRows.length,
    })
  }
  return out
}
