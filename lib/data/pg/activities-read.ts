import { getSupabaseClient } from '@/lib/data/pg/client'
import { isUuid } from '@/lib/data/pg/mappers'
import { ACTIONS } from '@/lib/data/activity-actions'

// Postgres read side of the `activities` log — the per-job timeline the Stage
// 14 (Phase B1) CRM renders, plus the one timeline-note append it owns.
// See docs/stage-14-crm-interface-design.md ("B1 — data layer").
//
// The write side (audit appends from webhooks / admin actions) lives in
// lib/data/pg/audit.ts; this file is the timeline reader + addJobNote.
//
// POSTGRES-ONLY: there is no sheet timeline. lib/data/index.ts returns [] in
// sheet mode (listActivitiesForJob) and routes addJobNote to appendAuditRow
// best-effort. ALL-STRINGS BOUNDARY DISCIPLINE: no null/undefined crosses out
// — `at` is ISO-normalized, the free-text columns coerce to '' when NULL.

const PAGE_SIZE = 1000

// ---------------------------------------------------------------------------
// Type — the timeline activity (re-exported via lib/data/index.ts).
// ---------------------------------------------------------------------------

// One `activities` row, coerced to the all-strings discipline. `actor` /
// `action` stay free-form text (the activity-actions vocabulary is a typed
// layer, not a DB constraint); `before`/`after`/`target`/`notes` coerce to ''
// when NULL. `data` is the opportunistic JSON passthrough (the jsonb column
// audit.ts populates) — left as-is for the timeline to inspect; null stays
// null since it is structured data, not a boundary string.
export interface Activity {
  id: string
  at: string
  actor: string
  action: string
  target: string
  before: string
  after: string
  notes: string
  jobId: string
  data: unknown
}

interface DbActivity {
  id: number | string
  at: string | null
  actor: string | null
  action: string | null
  target: string | null
  before: string | null
  after: string | null
  notes: string | null
  job_id: string | null
  data: unknown
}

function strFromText(value: string | null | undefined): string {
  return value ?? ''
}

// Normalize through the JS Date constructor so PostgREST's microsecond/+00:00
// shape renders as the canonical ISO the rest of the app uses; empty -> ''.
function strFromTimestamp(value: string | null | undefined): string {
  if (!value) return ''
  return new Date(value).toISOString()
}

function mapActivity(row: DbActivity): Activity {
  return {
    id: String(row.id),
    at: strFromTimestamp(row.at),
    actor: strFromText(row.actor),
    action: strFromText(row.action),
    target: strFromText(row.target),
    before: strFromText(row.before),
    after: strFromText(row.after),
    notes: strFromText(row.notes),
    jobId: strFromText(row.job_id),
    // data is structured jsonb (or null) — passthrough, not a boundary string.
    data: row.data ?? null,
  }
}

const ACTIVITY_COLUMNS = 'id,at,actor,action,target,before,after,notes,job_id,data'

// ---------------------------------------------------------------------------
// Read — the per-job timeline, newest-first.
// ---------------------------------------------------------------------------

// activities where job_id = $1, ordered `at` desc, paginated. Non-UUID jobId
// returns [] without querying (the uuid-typed .eq() would throw 22P02 on
// garbage; parity with the repo's UUID gate). id is the tiebreak so rows with
// an identical `at` (same-instant writes) have a stable, deterministic order.
export async function listActivitiesForJob(jobId: string): Promise<Activity[]> {
  if (!isUuid(jobId)) return []
  const client = getSupabaseClient()
  const rows: DbActivity[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await client
      .from('activities')
      .select(ACTIVITY_COLUMNS)
      .eq('job_id', jobId)
      .order('at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      throw new Error(`pg/activities-read: listActivitiesForJob page read failed: ${error.message}`)
    }
    const page = (data ?? []) as unknown as DbActivity[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows.map(mapActivity)
}

// ---------------------------------------------------------------------------
// Write — the timeline note append B1 owns.
// ---------------------------------------------------------------------------

// Insert an activities row: action='note.added', the supplied actor, the note
// text in `notes`, job_id = jobId, at = now (ISO, generated here — callers
// never supply a timestamp, mirroring pg/audit.ts). Non-UUID jobId is a
// graceful no-op (the note has no job to attach to) returning { ok: false }.
export async function addJobNote(
  jobId: string,
  actor: string,
  text: string,
): Promise<{ ok: boolean }> {
  if (!isUuid(jobId)) return { ok: false }
  const client = getSupabaseClient()
  const { error } = await client.from('activities').insert({
    at: new Date().toISOString(),
    actor,
    action: ACTIONS.NOTE_ADDED,
    target: '',
    notes: text || null,
    job_id: jobId,
  })
  if (error) throw new Error(`pg/activities-read: addJobNote insert failed: ${error.message}`)
  return { ok: true }
}
