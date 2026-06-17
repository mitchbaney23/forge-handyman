import { getBackend } from '@/lib/data/backend'
import * as pgActivitiesRead from '@/lib/data/pg/activities-read'
import * as pgAppointments from '@/lib/data/pg/appointments'
import * as pgAudit from '@/lib/data/pg/audit'
import * as pgCustomers from '@/lib/data/pg/customers'
import * as pgExport from '@/lib/data/pg/export'
import * as pgQueries from '@/lib/data/pg/queries'
import * as pgRepo from '@/lib/data/pg/repo'
import { ACTIONS } from '@/lib/data/activity-actions'
import * as sheetAudit from '@/lib/sheet/audit-log'
import * as sheetExport from '@/lib/sheet/export'
import * as sheetQueries from '@/lib/sheet/queries'
import * as sheetRepo from '@/lib/sheet/repo'
import type { Activity } from '@/lib/data/pg/activities-read'
import type { AppointmentRow, TechnicianRow } from '@/lib/data/pg/appointments'
import type {
  CustomerDetail,
  CustomerStats,
  CustomerSummary,
} from '@/lib/data/pg/customers'
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

// Stage 14 (Phase B1) CRM read surface — postgres-only. See the dispatched
// exports at the bottom of this file and lib/data/pg/{customers,activities-read}.
export type {
  CustomerSummary,
  CustomerDetail,
  CustomerProperty,
  CustomerStats,
} from '@/lib/data/pg/customers'
export type { Activity } from '@/lib/data/pg/activities-read'

// Phase C scheduling — postgres-only (see the dispatched exports at the bottom).
export type { AppointmentRow, TechnicianRow } from '@/lib/data/pg/appointments'

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

// ---------------------------------------------------------------------------
// CRM read surface — Stage 14 (Phase B1). POSTGRES-ONLY: there is no sheet
// counterpart. In sheet mode each read returns its empty value and the pages
// render an honest "available once you're on Postgres" notice (crmEnabled()).
// addJobNote is the one exception — it routes to appendAuditRow best-effort so
// a note isn't silently dropped on a sheet-mode deployment.
// (lib/data/pg/{customers,activities-read}.ts)
// ---------------------------------------------------------------------------

// True when the new CRM surfaces have a real backend. Pages gate their
// rendering on this (postgres-only); sheet mode shows the "on Postgres" notice.
export function crmEnabled(): boolean {
  return getBackend() === 'postgres'
}

export async function listCustomers(): Promise<CustomerSummary[]> {
  return getBackend() === 'postgres' ? pgCustomers.listCustomers() : []
}

export async function getCustomerById(id: string): Promise<CustomerDetail | null> {
  return getBackend() === 'postgres' ? pgCustomers.getCustomerById(id) : null
}

export async function getCustomerStats(): Promise<CustomerStats> {
  return getBackend() === 'postgres'
    ? pgCustomers.getCustomerStats()
    : { totalCustomers: '0', totalJobs: '0' }
}

export async function updateCustomerNotes(
  id: string,
  notes: string,
): Promise<{ updated: boolean }> {
  // Sheet has no customers table — a no-op, mirroring redactCustomerByEmail.
  return getBackend() === 'postgres'
    ? pgCustomers.updateCustomerNotes(id, notes)
    : { updated: false }
}

export async function listActivitiesForJob(jobId: string): Promise<Activity[]> {
  return getBackend() === 'postgres' ? pgActivitiesRead.listActivitiesForJob(jobId) : []
}

export async function addJobNote(
  jobId: string,
  actor: string,
  text: string,
): Promise<{ ok: boolean }> {
  if (getBackend() === 'postgres') return pgActivitiesRead.addJobNote(jobId, actor, text)
  // Sheet mode: no timeline to read back, but record the note best-effort on
  // the Audit tab so it isn't lost. target carries the jobId (the sheet Audit
  // convention); a failure here must never surface to the caller.
  try {
    await sheetAudit.appendAuditRow({
      actor,
      action: ACTIONS.NOTE_ADDED,
      target: jobId,
      notes: text,
      jobId,
    })
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

// ---------------------------------------------------------------------------
// Appointments / scheduling (lib/data/pg/appointments.ts) — Phase C.
// Postgres-only: sheet mode no-ops (returns null/empty) since prod is on pg.
// ---------------------------------------------------------------------------

export async function claimSlot(args: {
  jobId: string
  technicianId: string
  startsAt: string
  endsAt: string
  googleEventId?: string
}): Promise<AppointmentRow | null> {
  return getBackend() === 'postgres' ? pgAppointments.claimSlot(args) : null
}

export async function linkAppointment(
  id: string,
  fields: { jobId?: string; googleEventId?: string },
): Promise<void> {
  if (getBackend() === 'postgres') await pgAppointments.linkAppointment(id, fields)
}

export async function releaseSlot(id: string): Promise<void> {
  if (getBackend() === 'postgres') await pgAppointments.releaseSlot(id)
}

export async function listAppointmentsInRange(
  fromIso: string,
  toIso: string,
): Promise<AppointmentRow[]> {
  return getBackend() === 'postgres'
    ? pgAppointments.listAppointmentsInRange(fromIso, toIso)
    : []
}

export async function getDefaultTechnician(): Promise<TechnicianRow | null> {
  return getBackend() === 'postgres' ? pgAppointments.getDefaultTechnician() : null
}
