import { getSupabaseClient } from '@/lib/data/pg/client'
import { isUuid, toContactRow, type DbJob } from '@/lib/data/pg/mappers'
import type { JobRow, PriorJobsSummary } from '@/lib/sheet/queries'

// Postgres implementation of the lib/sheet/queries read surface (Stage 13).
// Signatures and return shapes match the sheet versions exactly; the pure
// helpers (groupJobsForOverview, isSameLocalDay, status sets, …) stay in
// lib/sheet/queries and are re-exported backend-independently by
// lib/data/index.ts.
//
// Pagination contract (docs/stage-13-postgres-design.md): PostgREST caps
// responses at 1000 rows, so every multi-row read loops .range() with a
// stable order (submitted_at asc, id tiebreak — append order, like the
// sheet) until a short page returns.

const PAGE_SIZE = 1000
const ONE_DAY_MS = 24 * 60 * 60 * 1000

type PageResult = { data: unknown[] | null; error: { message: string } | null }

async function fetchAllPages(
  context: string,
  fetchPage: (from: number, to: number) => PromiseLike<PageResult>,
): Promise<DbJob[]> {
  const rows: DbJob[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await fetchPage(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`pg/queries: ${context} page read failed: ${error.message}`)
    const page = (data ?? []) as DbJob[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

// rowNumber is synthetic (list index + 2, as if the rows sat under a sheet
// header row) — callers only use it as a React key / log label.
function toJobRow(dbRow: DbJob, index: number): JobRow {
  return { ...toContactRow(dbRow), rowNumber: index + 2 }
}

export async function listJobs(): Promise<JobRow[]> {
  const client = getSupabaseClient()
  const dbRows = await fetchAllPages('listJobs', (from, to) =>
    client
      .from('jobs')
      .select('*')
      .order('submitted_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
  return dbRows.map(toJobRow)
}

export async function findPriorJobsByEmail(
  email: string,
  excludeJobId?: string,
): Promise<PriorJobsSummary> {
  if (!email) return { count: 0, rows: [] }
  const trimmed = email.trim()
  const client = getSupabaseClient()
  // citext .eq() is case-insensitive — parity with the sheet's
  // trim().toLowerCase() matching (job emails are trimmed at the write
  // boundary). excludeJobId is only applied when UUID-shaped: a non-UUID
  // value can't equal any jobs.id (all UUIDs post-migration), and passing it
  // to a uuid .neq() would throw 22P02 where the sheet just matched nothing.
  const dbRows = await fetchAllPages('findPriorJobsByEmail', (from, to) => {
    let query = client.from('jobs').select('*').eq('email', trimmed)
    if (excludeJobId && isUuid(excludeJobId)) query = query.neq('id', excludeJobId)
    return query
      .order('submitted_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  })
  const rows = dbRows.map(toJobRow)
  return { count: rows.length, rows }
}

export async function countDuplicateLeadsLast24h(
  email: string,
  exceptJobId: string,
): Promise<number> {
  if (!email) return 0
  const client = getSupabaseClient()
  const cutoffIso = new Date(Date.now() - ONE_DAY_MS).toISOString()
  // Sheet parity: rows with empty/unparseable submitted_at were excluded
  // (epoch 0 < cutoff); in pg submitted_at is NOT NULL so .gte covers it.
  let query = client
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .eq('email', email.trim())
    .gte('submitted_at', cutoffIso)
  if (isUuid(exceptJobId)) query = query.neq('id', exceptJobId)
  const { count, error } = await query
  if (error) {
    throw new Error(`pg/queries: countDuplicateLeadsLast24h count failed: ${error.message}`)
  }
  return count ?? 0
}
