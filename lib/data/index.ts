import { getBackend } from '@/lib/data/backend'
import * as pgAudit from '@/lib/data/pg/audit'
import * as pgExport from '@/lib/data/pg/export'
import * as pgQueries from '@/lib/data/pg/queries'
import * as pgRepo from '@/lib/data/pg/repo'
import * as sheetAudit from '@/lib/sheet/audit-log'
import * as sheetExport from '@/lib/sheet/export'
import * as sheetQueries from '@/lib/sheet/queries'
import * as sheetRepo from '@/lib/sheet/repo'
import type { AuditEntry } from '@/lib/sheet/audit-log'
import type { JobRow, PriorJobsSummary } from '@/lib/sheet/queries'
import type { ContactRow, ContactRowPartial } from '@/lib/sheet/repo'

// THE data-layer import for all call sites (Stage 13). Every backend-touching
// function below resolves getBackend() PER CALL — never at module load — so
// the cutover flip (DATA_BACKEND env change + redeploy) takes effect without
// stale module-scope bindings, and tests can toggle backends freely.
//
// Call sites import from '@/lib/data' instead of
// '@/lib/sheet/{repo,queries,audit-log,export}'. Type-only imports may keep
// their old homes (types are re-exported from both).

// ---------------------------------------------------------------------------
// Types — re-exported from their existing homes (shared by both backends).
// ---------------------------------------------------------------------------

export type { ContactRow, ContactRowPartial } from '@/lib/sheet/repo'
export type { JobRow, PriorJobsSummary } from '@/lib/sheet/queries'
export type { AuditEntry } from '@/lib/sheet/audit-log'

// ---------------------------------------------------------------------------
// Pure helpers + constants — backend-independent, re-exported directly.
// ---------------------------------------------------------------------------

export { SHEET_HEADERS } from '@/lib/sheet/repo'
export {
  groupJobsForOverview,
  isSameLocalDay,
  toLocalIsoDate,
  NEEDS_TRIAGE_STATUSES,
  ACTIVE_STATUSES,
  COMPLETED_STATUSES,
  QUOTED_STATUSES,
} from '@/lib/sheet/queries'

// ---------------------------------------------------------------------------
// Repo (lib/sheet/repo.ts ↔ lib/data/pg/repo.ts)
// ---------------------------------------------------------------------------

export async function appendContactRow(row: ContactRow): Promise<{ rowNumber: number }> {
  return getBackend() === 'postgres'
    ? pgRepo.appendContactRow(row)
    : sheetRepo.appendContactRow(row)
}

export async function findRowByJobId(
  jobId: string,
): Promise<{ rowNumber: number; row: ContactRow } | null> {
  return getBackend() === 'postgres'
    ? pgRepo.findRowByJobId(jobId)
    : sheetRepo.findRowByJobId(jobId)
}

export async function updateRowByJobId(
  jobId: string,
  updates: ContactRowPartial,
): Promise<{ updated: boolean; rowNumber?: number }> {
  return getBackend() === 'postgres'
    ? pgRepo.updateRowByJobId(jobId, updates)
    : sheetRepo.updateRowByJobId(jobId, updates)
}

// Sheet mode is a no-op: the sheet has no customers table — the data-requests
// action's per-job updateRowByJobId loop already redacts everything the sheet
// stores. In postgres mode this additionally redacts the normalized customer.
export async function redactCustomerByEmail(email: string): Promise<{ updated: boolean }> {
  if (getBackend() === 'postgres') return pgRepo.redactCustomerByEmail(email)
  return { updated: false }
}

// Sheet mode is a no-op: the sheet has no `legacy` column. In postgres mode
// this nulls jobs.legacy for the given ids so a deletion request leaves no PII
// behind in the migration's raw-row stash (and the daily backup CSV).
export async function redactJobLegacyByIds(jobIds: string[]): Promise<{ updated: number }> {
  if (getBackend() === 'postgres') return pgRepo.redactJobLegacyByIds(jobIds)
  return { updated: 0 }
}

// ---------------------------------------------------------------------------
// Queries (lib/sheet/queries.ts ↔ lib/data/pg/queries.ts)
// ---------------------------------------------------------------------------

export async function listJobs(): Promise<JobRow[]> {
  return getBackend() === 'postgres' ? pgQueries.listJobs() : sheetQueries.listJobs()
}

export async function findPriorJobsByEmail(
  email: string,
  excludeJobId?: string,
): Promise<PriorJobsSummary> {
  return getBackend() === 'postgres'
    ? pgQueries.findPriorJobsByEmail(email, excludeJobId)
    : sheetQueries.findPriorJobsByEmail(email, excludeJobId)
}

export async function countDuplicateLeadsLast24h(
  email: string,
  exceptJobId: string,
): Promise<number> {
  return getBackend() === 'postgres'
    ? pgQueries.countDuplicateLeadsLast24h(email, exceptJobId)
    : sheetQueries.countDuplicateLeadsLast24h(email, exceptJobId)
}

// ---------------------------------------------------------------------------
// Audit (lib/sheet/audit-log.ts ↔ lib/data/pg/audit.ts)
// ---------------------------------------------------------------------------

export async function appendAuditRow(entry: AuditEntry): Promise<void> {
  return getBackend() === 'postgres'
    ? pgAudit.appendAuditRow(entry)
    : sheetAudit.appendAuditRow(entry)
}

export async function ensureAuditTab(): Promise<{ created: boolean }> {
  return getBackend() === 'postgres' ? pgAudit.ensureAuditTab() : sheetAudit.ensureAuditTab()
}

// ---------------------------------------------------------------------------
// Export (lib/sheet/export.ts ↔ lib/data/pg/export.ts)
// ---------------------------------------------------------------------------

export async function exportAllTabsCsv(): Promise<
  { tabName: string; csv: string; rowCount: number }[]
> {
  return getBackend() === 'postgres'
    ? pgExport.exportAllTabsCsv()
    : sheetExport.exportAllTabsCsv()
}
