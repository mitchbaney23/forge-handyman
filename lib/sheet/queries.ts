import { google } from 'googleapis'
import {
  SHEET_HEADERS,
  SHEET_RANGE_FULL,
  getSheetAuth,
  type ContactRow,
} from '@/lib/sheet/repo'

export interface JobRow extends ContactRow {
  rowNumber: number
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID
  if (!id) throw new Error('GOOGLE_SHEET_ID is not configured')
  return id
}

function parseRow(values: unknown[], rowNumber: number): JobRow {
  const row: Record<string, string> = {}
  SHEET_HEADERS.forEach((header, idx) => {
    row[header] = String(values[idx] ?? '')
  })
  return { ...(row as unknown as ContactRow), rowNumber }
}

export async function listJobs(): Promise<JobRow[]> {
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: SHEET_RANGE_FULL,
  })
  const values = response.data.values ?? []
  if (values.length < 2) return []
  const rows: JobRow[] = []
  for (let i = 1; i < values.length; i++) {
    rows.push(parseRow(values[i], i + 1))
  }
  return rows
}

// Eastern-time bucketing for the dashboard's Today/Tomorrow groups. The
// canonical helpers now live in lib/scheduling/time.ts (so scheduling code
// doesn't depend on this sheet module); imported for internal use here and
// re-exported for back-compat with existing importers (lib/data/index.ts, tests).
import { isSameLocalDay, toLocalIsoDate } from '@/lib/scheduling/time'
export { isSameLocalDay, toLocalIsoDate }

export const NEEDS_TRIAGE_STATUSES = new Set(['New'])
export const ACTIVE_STATUSES = new Set(['Booked', 'In Progress'])
export const COMPLETED_STATUSES = new Set(['Complete'])
export const QUOTED_STATUSES = new Set(['Quoted', 'Pending Follow-Up'])

export interface PriorJobsSummary {
  count: number
  rows: JobRow[]
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export async function findPriorJobsByEmail(
  email: string,
  excludeJobId?: string,
): Promise<PriorJobsSummary> {
  if (!email) return { count: 0, rows: [] }
  const normalized = email.trim().toLowerCase()
  const all = await listJobs()
  const matches = all.filter(
    (row) =>
      (row.email || '').trim().toLowerCase() === normalized &&
      (!excludeJobId || row.job_id !== excludeJobId),
  )
  return { count: matches.length, rows: matches }
}

export async function countDuplicateLeadsLast24h(
  email: string,
  exceptJobId: string,
): Promise<number> {
  if (!email) return 0
  const normalized = email.trim().toLowerCase()
  const cutoff = Date.now() - ONE_DAY_MS
  const all = await listJobs()
  return all.filter((row) => {
    if (row.job_id === exceptJobId) return false
    if ((row.email || '').trim().toLowerCase() !== normalized) return false
    const submittedAt = row.submitted_at ? new Date(row.submitted_at).getTime() : 0
    return submittedAt >= cutoff
  }).length
}

export function groupJobsForOverview(jobs: JobRow[]): {
  needsTriage: JobRow[]
  today: JobRow[]
  tomorrow: JobRow[]
  recentlyComplete: JobRow[]
  openQuotes: JobRow[]
} {
  const todayDate = new Date()
  const tomorrowDate = new Date()
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const sevenDaysAgoIso = sevenDaysAgo.toISOString()

  const needsTriage: JobRow[] = []
  const today: JobRow[] = []
  const tomorrow: JobRow[] = []
  const recentlyComplete: JobRow[] = []
  const openQuotes: JobRow[] = []

  for (const job of jobs) {
    const status = (job.status || '').trim()
    if (NEEDS_TRIAGE_STATUSES.has(status)) needsTriage.push(job)
    if (QUOTED_STATUSES.has(status)) openQuotes.push(job)
    if (ACTIVE_STATUSES.has(status)) {
      if (isSameLocalDay(job.preferred_date, todayDate)) today.push(job)
      else if (isSameLocalDay(job.preferred_date, tomorrowDate)) tomorrow.push(job)
    }
    if (
      COMPLETED_STATUSES.has(status) &&
      (job.complete_date || '') >= sevenDaysAgoIso
    ) {
      recentlyComplete.push(job)
    }
  }

  needsTriage.sort((a, b) => (b.submitted_at || '').localeCompare(a.submitted_at || ''))
  today.sort((a, b) => (a.preferred_date || '').localeCompare(b.preferred_date || ''))
  tomorrow.sort((a, b) => (a.preferred_date || '').localeCompare(b.preferred_date || ''))
  recentlyComplete.sort((a, b) => (b.complete_date || '').localeCompare(a.complete_date || ''))
  openQuotes.sort((a, b) => (a.submitted_at || '').localeCompare(b.submitted_at || ''))

  return { needsTriage, today, tomorrow, recentlyComplete, openQuotes }
}
