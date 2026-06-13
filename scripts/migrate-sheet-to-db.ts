#!/usr/bin/env -S npx tsx
/**
 * One-shot migration of the Forge master Google Sheet into Supabase Postgres
 * (Stage 13 cutover — docs/stage-13-postgres-design.md, "Migration script").
 *
 * Modes:
 *   (default)   dry-run — read + validate EVERYTHING, write nothing, print
 *               the full validation report.
 *   --execute   wipe-and-reload migrate: truncate_for_migration() RPC, then
 *               batch-insert customers → jobs → activities. REFUSED while
 *               DATA_BACKEND=postgres (post-flip safety) unless --force.
 *   --verify    post-cutover diff (the rollback / lost-write detector): every
 *               sheet row vs its Postgres job mapped through toContactRow,
 *               field by field. Read-only.
 *   --force     allow --execute while DATA_BACKEND=postgres.
 *
 * Run with: npx tsx scripts/migrate-sheet-to-db.ts [--execute|--verify] [--force]
 *
 * Required env (loaded from .env.local or the shell, like setup-sheet.ts):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID,
 *   BUSINESS_EMAIL — always (sheet reads)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — for --execute / --verify
 *
 * This is a CLI: console output IS the report (the one sanctioned exception
 * to the shared pino logger rule).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { google } from 'googleapis'
import { getBackend } from '@/lib/data/backend'
import { getSupabaseClient } from '@/lib/data/pg/client'
import { toContactRow, type DbJob } from '@/lib/data/pg/mappers'
import { getSheetAuth } from '@/lib/sheet/repo'
import { AUDIT_RANGE } from '@/lib/sheet/audit-log'
import { listJobs } from '@/lib/sheet/queries'
import {
  buildMigrationPlan,
  diffContactRows,
  planAuditActivity,
  rawCellsFromContactRow,
  renderPlannedJobAsContactRow,
  type MigrationIssue,
  type MigrationPlan,
  type PlannedActivity,
  type PlannedJob,
  type RawSheetRow,
} from './migration-helpers'

const BATCH_SIZE = 500
const PG_PAGE_SIZE = 1000 // PostgREST caps responses at 1000 rows by default

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

type Mode = 'dry-run' | 'execute' | 'verify'

function usage(): void {
  console.error('Usage: npx tsx scripts/migrate-sheet-to-db.ts [--execute|--verify] [--force]')
  console.error('  (no flags)  dry-run: read + validate everything, write nothing')
  console.error('  --execute   truncate customers/jobs/activities, then migrate')
  console.error('  --verify    post-cutover diff of every sheet row against Postgres (read-only)')
  console.error('  --force     allow --execute while DATA_BACKEND=postgres')
}

function parseArgs(argv: string[]): { mode: Mode; force: boolean } | null {
  let execute = false
  let verify = false
  let force = false
  for (const arg of argv) {
    if (arg === '--execute') execute = true
    else if (arg === '--verify') verify = true
    else if (arg === '--force') force = true
    else {
      console.error(`Unknown argument: ${arg}`)
      return null
    }
  }
  if (execute && verify) {
    console.error('--execute and --verify are mutually exclusive')
    return null
  }
  return { mode: execute ? 'execute' : verify ? 'verify' : 'dry-run', force }
}

// ---------------------------------------------------------------------------
// Sheet reads
// ---------------------------------------------------------------------------

async function readSheetRows(): Promise<RawSheetRow[]> {
  const jobs = await listJobs()
  return jobs.map((job) => ({ rowNumber: job.rowNumber, cells: rawCellsFromContactRow(job) }))
}

interface AuditSheetRow {
  rowNumber: number
  cells: string[]
}

// The sheet layer has no Audit read API (audit-log.ts only appends), so the
// migration reads 'Audit!A:G' itself with the same String-coercion the sheet
// layer applies everywhere: String(v ?? ''), missing trailing cells → ''.
async function readAuditRows(): Promise<{ rows: AuditSheetRow[]; tabMissing: boolean }> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID
  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID is not configured')
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  let values: unknown[][]
  try {
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: AUDIT_RANGE })
    values = (response.data.values ?? []) as unknown[][]
  } catch (err) {
    // A spreadsheet without the Audit tab yields "Unable to parse range".
    if (err instanceof Error && err.message.includes('Unable to parse range')) {
      return { rows: [], tabMissing: true }
    }
    throw err
  }
  if (values.length < 2) return { rows: [], tabMissing: false }
  return {
    tabMissing: false,
    rows: values.slice(1).map((row, i) => ({
      rowNumber: i + 2, // 1-based, header-inclusive — same convention as Sheet1
      cells: Array.from({ length: 7 }, (_, col) => String(row[col] ?? '')),
    })),
  }
}

// ---------------------------------------------------------------------------
// Postgres helpers
// ---------------------------------------------------------------------------

async function countPg(table: 'customers' | 'jobs' | 'activities'): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from(table)
    .select('*', { count: 'exact', head: true })
  if (error) throw new Error(`count(${table}) failed: ${error.message}`)
  return count ?? 0
}

async function insertBatches(
  table: 'customers' | 'jobs' | 'activities',
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) {
    console.log(`  ${table}: nothing to insert`)
    return
  }
  const client = getSupabaseClient()
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE)
    const { error } = await client.from(table).insert(batch)
    if (error) {
      throw new Error(
        `insert into ${table} failed at batch offset ${offset}: ${error.message} ` +
          '(re-run --execute after fixing — wipe-and-reload makes a crashed run fully recoverable)',
      )
    }
    console.log(`  ${table}: ${Math.min(offset + BATCH_SIZE, rows.length)}/${rows.length} inserted`)
  }
}

// Paginated full-table read — PostgREST silently truncates at 1000 rows, so
// loop .range() with a stable order until a short page returns.
async function fetchAllPgJobs(): Promise<DbJob[]> {
  const client = getSupabaseClient()
  const all: DbJob[] = []
  for (let offset = 0; ; offset += PG_PAGE_SIZE) {
    const { data, error } = await client
      .from('jobs')
      .select('*')
      .order('id', { ascending: true })
      .range(offset, offset + PG_PAGE_SIZE - 1)
    if (error) throw new Error(`paginated jobs read failed at offset ${offset}: ${error.message}`)
    const page = (data ?? []) as DbJob[]
    all.push(...page)
    if (page.length < PG_PAGE_SIZE) return all
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printIssues(issues: MigrationIssue[]): void {
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  if (errors.length > 0) {
    console.log('')
    console.log(`Validation ERRORS (${errors.length}) — these block --execute:`)
    for (const issue of errors) {
      console.log(`  [error] ${issue.rowNumber === null ? '' : `row ${issue.rowNumber} `}${issue.field}: ${issue.message}`)
    }
  }
  if (warnings.length > 0) {
    console.log('')
    console.log(`Warnings (${warnings.length}) — migrated anyway, review each:`)
    for (const issue of warnings) {
      console.log(`  [warn]  ${issue.rowNumber === null ? '' : `row ${issue.rowNumber} `}${issue.field}: ${issue.message}`)
    }
  }
  if (errors.length === 0 && warnings.length === 0) {
    console.log('')
    console.log('No anomalies found.')
  }
}

interface AuditSummary {
  totalRows: number
  tabMissing: boolean
  activities: PlannedActivity[]
  skipped: number
  issues: MigrationIssue[]
}

function printPlanReport(plan: MigrationPlan, audit: AuditSummary): void {
  const redacted = plan.customers.filter((c) => c.email.startsWith('redacted:')).length
  const unknown = plan.customers.filter((c) => c.email.startsWith('unknown:')).length
  const grouped = plan.customers.length - redacted - unknown

  console.log('')
  console.log('--- Migration plan ---')
  console.log(`Sheet1 data rows:     ${plan.totalSheetRows}`)
  console.log(`Jobs to insert:       ${plan.jobs.length}`)
  console.log(
    `Customers to insert:  ${plan.customers.length} ` +
      `(${grouped} grouped by email, ${redacted} redacted:<uuid>, ${unknown} unknown:<uuid>)`,
  )
  console.log(
    `Audit data rows:      ${audit.totalRows}${audit.tabMissing ? '  !! Audit tab not found in the spreadsheet' : ''}`,
  )
  console.log(`Activities to insert: ${audit.activities.length} (${audit.skipped} skipped: unparseable timestamp)`)

  if (plan.duplicateJobIds.length > 0) {
    console.log('')
    console.log(`!!! DUPLICATE job_ids (${plan.duplicateJobIds.length}) — keeping the FIRST occurrence`)
    console.log('    (matches findRowByJobId first-match semantics); discarded raw rows are')
    console.log("    stashed in the kept job's legacy.duplicates[]:")
    for (const dup of plan.duplicateJobIds) {
      console.log(`  ${dup.jobId}: kept row ${dup.keptRowNumber}, discarded row(s) ${dup.discardedRowNumbers.join(', ')}`)
    }
  }

  if (plan.mintedJobIds.length > 0) {
    console.log('')
    console.log(`Minted deterministic UUIDv5 job_ids (${plan.mintedJobIds.length}) — stable across runs:`)
    for (const minted of plan.mintedJobIds) {
      const reason =
        minted.invalidValue === undefined
          ? 'job_id was empty'
          : `replacing invalid job_id ${JSON.stringify(minted.invalidValue)} (kept in legacy.invalidJobId)`
      console.log(`  row ${minted.rowNumber}: ${minted.jobId} (${reason})`)
    }
  }

  printIssues([...plan.issues, ...audit.issues])

  if (plan.excludedRowNumbers.length > 0) {
    console.log('')
    console.log(`Rows excluded by validation errors: ${plan.excludedRowNumbers.join(', ')}`)
  }
}

function finish(pass: boolean, message: string): void {
  console.log('')
  console.log(pass ? `RESULT: PASS — ${message}` : `RESULT: FAIL — ${message}`)
  if (!pass) process.exitCode = 1
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function buildAuditSummary(rows: AuditSheetRow[], tabMissing: boolean): AuditSummary {
  const activities: PlannedActivity[] = []
  const issues: MigrationIssue[] = []
  let skipped = 0
  for (const row of rows) {
    const planned = planAuditActivity(row.rowNumber, row.cells)
    if (planned.activity) activities.push(planned.activity)
    else skipped += 1
    if (planned.issue) issues.push(planned.issue)
  }
  return { totalRows: rows.length, tabMissing, activities, skipped, issues }
}

async function runDryRun(plan: MigrationPlan, audit: AuditSummary): Promise<void> {
  printPlanReport(plan, audit)

  // Best-effort context only — a dry-run must not require Supabase env.
  console.log('')
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const [customers, jobs, activities] = await Promise.all([
        countPg('customers'),
        countPg('jobs'),
        countPg('activities'),
      ])
      console.log(
        `Current Postgres counts (dry-run writes nothing): customers=${customers} jobs=${jobs} activities=${activities}`,
      )
    } catch (err) {
      console.log(`Could not read Postgres counts: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    console.log('Postgres counts skipped (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — not required for a dry-run)')
  }

  if (plan.ok) {
    finish(true, 'validation clean; re-run with --execute to migrate')
  } else {
    finish(false, 'validation errors above must be fixed in the sheet before --execute')
  }
}

async function runExecute(plan: MigrationPlan, audit: AuditSummary): Promise<void> {
  printPlanReport(plan, audit)

  if (!plan.ok) {
    finish(false, 'validation errors — nothing was written (truncate was NOT called)')
    return
  }

  console.log('')
  console.log('Truncating customers, jobs, activities (truncate_for_migration RPC)…')
  const { error: truncateError } = await getSupabaseClient().rpc('truncate_for_migration')
  if (truncateError) {
    throw new Error(
      `truncate_for_migration() failed: ${truncateError.message} ` +
        '(is db/schema.sql applied? The function is dropped after cutover — see schema.sql)',
    )
  }

  console.log(`Inserting in batches of ${BATCH_SIZE}…`)
  await insertBatches('customers', plan.customers as unknown as Record<string, unknown>[])
  await insertBatches('jobs', plan.jobs as unknown as Record<string, unknown>[])
  await insertBatches('activities', audit.activities as unknown as Record<string, unknown>[])

  const [customerCount, jobCount, activityCount] = await Promise.all([
    countPg('customers'),
    countPg('jobs'),
    countPg('activities'),
  ])

  const duplicateRowCount = plan.duplicateJobIds.reduce(
    (sum, dup) => sum + dup.discardedRowNumbers.length,
    0,
  )
  console.log('')
  console.log('--- Sheet vs Postgres counts ---')
  console.log(
    `jobs:       sheet ${plan.totalSheetRows} data rows → planned ${plan.jobs.length}` +
      `${duplicateRowCount > 0 ? ` (${duplicateRowCount} duplicate row(s) folded into legacy.duplicates)` : ''}` +
      ` → pg ${jobCount} ${jobCount === plan.jobs.length ? 'OK' : 'MISMATCH'}`,
  )
  console.log(
    `customers:  planned ${plan.customers.length} → pg ${customerCount} ` +
      `${customerCount === plan.customers.length ? 'OK' : 'MISMATCH'}`,
  )
  console.log(
    `activities: audit ${audit.totalRows} rows → planned ${audit.activities.length}` +
      `${audit.skipped > 0 ? ` (${audit.skipped} skipped)` : ''}` +
      ` → pg ${activityCount} ${activityCount === audit.activities.length ? 'OK' : 'MISMATCH'}`,
  )

  const countsMatch =
    jobCount === plan.jobs.length &&
    customerCount === plan.customers.length &&
    activityCount === audit.activities.length

  if (countsMatch) {
    finish(true, 'migration complete, all per-table counts match — run --verify after the DATA_BACKEND flip')
  } else {
    finish(false, 'post-insert counts do not match the plan — investigate before flipping DATA_BACKEND')
  }
}

async function runVerify(rawRows: RawSheetRow[]): Promise<void> {
  // Re-derive the exact plan --execute used (deterministic ids included) and
  // render what each Postgres job should look like through toContactRow.
  const plan = buildMigrationPlan(rawRows, new Date().toISOString())
  if (!plan.ok) {
    console.log('')
    console.log('NOTE: the sheet no longer passes validation — affected rows cannot be compared:')
    printIssues(plan.issues.filter((issue) => issue.severity === 'error'))
  }

  console.log('Fetching all Postgres jobs (paginated)…')
  const pgJobs = await fetchAllPgJobs()
  console.log(`  ${pgJobs.length} jobs in Postgres`)

  const pgById = new Map<string, DbJob>(pgJobs.map((job) => [job.id, job]))
  const missingInPg: PlannedJob[] = []
  const divergent: { job: PlannedJob; diffs: ReturnType<typeof diffContactRows> }[] = []

  for (const job of plan.jobs) {
    const pgJob = pgById.get(job.id)
    if (!pgJob) {
      missingInPg.push(job)
      continue
    }
    pgById.delete(job.id)
    const diffs = diffContactRows(renderPlannedJobAsContactRow(job), toContactRow(pgJob))
    if (diffs.length > 0) divergent.push({ job, diffs })
  }
  const onlyInPg = [...pgById.values()]

  console.log('')
  console.log('--- Verification report (sheet → expected pg, field by field) ---')
  console.log(`Sheet jobs compared:   ${plan.jobs.length}`)
  console.log(`Divergent jobs:        ${divergent.length}`)
  console.log(`Missing in Postgres:   ${missingInPg.length}`)
  console.log(`Only in Postgres:      ${onlyInPg.length} (expected for jobs created after cutover)`)

  if (divergent.length > 0) {
    console.log('')
    console.log('Field divergences (likely freeze-window sheet writes — Telegram taps / unsubscribe):')
    for (const { job, diffs } of divergent) {
      console.log(`  job ${job.id} (sheet row ${job.legacy.rowNumber}):`)
      for (const diff of diffs) {
        console.log(`    ${diff.field}: sheet ${JSON.stringify(diff.expected)} ≠ pg ${JSON.stringify(diff.actual)}`)
      }
    }
  }
  if (missingInPg.length > 0) {
    console.log('')
    console.log('Jobs in the sheet but NOT in Postgres:')
    for (const job of missingInPg) {
      console.log(`  job ${job.id} (sheet row ${job.legacy.rowNumber}, submitted_at ${job.submitted_at})`)
    }
  }
  if (onlyInPg.length > 0) {
    console.log('')
    console.log('Jobs in Postgres but not in the sheet (informational):')
    for (const job of onlyInPg) {
      console.log(`  job ${job.id} (submitted_at ${job.submitted_at})`)
    }
  }

  // Count context for the other migrated tables (jobs are the field-level diff).
  try {
    const [customerCount, activityCount] = await Promise.all([countPg('customers'), countPg('activities')])
    console.log('')
    console.log(`Postgres counts: customers=${customerCount} activities=${activityCount}`)
  } catch (err) {
    console.log(`Could not read customers/activities counts: ${err instanceof Error ? err.message : String(err)}`)
  }

  const pass = plan.ok && divergent.length === 0 && missingInPg.length === 0
  if (pass) {
    finish(true, 'zero divergence between the sheet and Postgres')
  } else {
    finish(
      false,
      'divergences found — replay the listed writes in Postgres (or re-run --execute --force before unfreezing)',
    )
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args === null) {
    usage()
    process.exitCode = 1
    return
  }
  const { mode, force } = args
  console.log(`Forge sheet → Postgres migration — mode: ${mode}${force ? ' (--force)' : ''}`)

  if (mode === 'execute' && !force && getBackend() === 'postgres') {
    console.error('')
    console.error('REFUSED: DATA_BACKEND=postgres — the app is already writing to Postgres, and')
    console.error('--execute would TRUNCATE customers/jobs/activities and reload them from the')
    console.error('sheet, silently discarding every post-cutover write. If you really are')
    console.error('redoing the cutover (freeze in place, sheet is the source of truth), re-run')
    console.error('with --force.')
    process.exitCode = 1
    return
  }

  console.log('Reading Sheet1…')
  const rawRows = await readSheetRows()
  console.log(`  ${rawRows.length} data rows`)

  if (mode === 'verify') {
    await runVerify(rawRows)
    return
  }

  console.log('Reading Audit tab…')
  const auditRead = await readAuditRows()
  console.log(`  ${auditRead.rows.length} data rows${auditRead.tabMissing ? ' (Audit tab not found)' : ''}`)
  const audit = buildAuditSummary(auditRead.rows, auditRead.tabMissing)

  // Validate every row BEFORE the first write (truncate included): a failing
  // plan must never wipe the database.
  const plan = buildMigrationPlan(rawRows, new Date().toISOString())

  if (mode === 'dry-run') await runDryRun(plan, audit)
  else await runExecute(plan, audit)
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exitCode = 1
})
