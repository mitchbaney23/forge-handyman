import { getSupabaseClient } from '@/lib/data/pg/client'
import { isUuid } from '@/lib/data/pg/mappers'
import type { AuditEntry } from '@/lib/sheet/audit-log'

// Postgres implementation of the lib/sheet/audit-log surface (Stage 13).
// Rows land in `activities` — the append-only log that supersedes the Audit
// tab (and later doubles as the AI activity log, Phase E).

// Opportunistic parse: returns the parsed value only when it is a JSON
// object/array (Stripe handlers pass JSON-stringified payloads in
// before/after); plain strings like 'New' -> 'Booked' status values stay
// out of `data`.
function parseJsonObject(value: string | undefined): unknown {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

// Parity notes vs lib/sheet/audit-log.ts:
// - `at` is generated HERE at write time (new Date().toISOString()), exactly
//   like the sheet impl — callers cannot supply a timestamp.
// - before/after/notes absent/empty -> NULL (a queryable log treats absent as
//   NULL, not ''); this matches the migration's planAuditActivity convention
//   so migrated and live rows are byte-identical for absent values.
// - job_id is taken from `entry.jobId` when the caller supplied a UUID-shaped
//   one (callers that know their jobId pass it so the timeline associates
//   reliably even when `target` is a Stripe id or masked email), otherwise it
//   falls back to `target` when that is UUID-shaped. Set regardless of whether
//   such a job exists — activities has NO foreign key on purpose: an
//   append-only log must never fail a write on referential grounds (audit
//   rows for not-yet/never-existing jobs are a real webhook path).
// - data: merged shape is { before?: <parsed>, after?: <parsed> } — each key
//   present only when that side parsed to an object/array, NULL when neither
//   did. Keeping the two sides keyed (rather than spread/merged) means e.g.
//   data->'after'->>'payment_intent_id' is queryable without before/after
//   field collisions.
export async function appendAuditRow(entry: AuditEntry): Promise<void> {
  const client = getSupabaseClient()
  const before = parseJsonObject(entry.before)
  const after = parseJsonObject(entry.after)
  const data =
    before !== undefined || after !== undefined
      ? { ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) }
      : null
  const { error } = await client.from('activities').insert({
    at: new Date().toISOString(),
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    before: entry.before || null,
    after: entry.after || null,
    notes: entry.notes || null,
    job_id:
      entry.jobId && isUuid(entry.jobId)
        ? entry.jobId
        : isUuid(entry.target)
          ? entry.target
          : null,
    data,
  })
  if (error) throw new Error(`pg/audit: activities insert failed: ${error.message}`)
}

// The activities table is created by db/schema.sql — there is no tab to
// ensure. Kept async with the sheet impl's return shape so the per-call
// dispatch in lib/data/index.ts is signature-identical.
export async function ensureAuditTab(): Promise<{ created: boolean }> {
  return { created: false }
}
