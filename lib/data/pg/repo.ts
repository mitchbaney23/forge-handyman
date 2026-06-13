import { randomUUID } from 'node:crypto'
import { getSupabaseClient } from '@/lib/data/pg/client'
import { isUuid, toContactRow, toDbInsert, toDbUpdate, type DbJob } from '@/lib/data/pg/mappers'
import { logger } from '@/lib/security/logger'
import type { ContactRow, ContactRowPartial } from '@/lib/sheet/repo'

// Postgres implementation of the lib/sheet/repo write surface (Stage 13,
// docs/stage-13-postgres-design.md "Repo contracts"). Signatures and sentinel
// returns mirror the sheet versions exactly:
//   - non-UUID jobId  -> null / { updated: false } WITHOUT querying (the sheet
//     scan simply found nothing; pg must never surface a 22P02 throw)
//   - valid-but-absent UUID -> same sentinels, never a throw on no-match
//   - real API/env errors still throw, like the sheet layer's googleapis errors

const REDACTED = '[REDACTED]' // matches app/admin/data-requests/actions.ts

// appendContactRow — two steps, mirroring the sheet's single append:
//
// 1. Customer upsert (atomic, onConflict: 'email' against the citext unique
//    index — a real upsert, never select-then-insert, so concurrent first-time
//    submissions can't race). Newest-wins refresh rule: name/phone are
//    included in the payload ONLY when the incoming values are non-empty.
//    PostgREST's upsert generates `ON CONFLICT DO UPDATE SET` over exactly
//    the columns present in the body, so an empty incoming name/phone simply
//    isn't written — existing values are accepted, never overwritten with
//    empty (no follow-up update needed). On the insert path, absent columns
//    take the table defaults (''). notes/anonymized_at are never touched —
//    this function doesn't own them.
//    Empty email (can't happen via the zod-validated contact route) gets an
//    'unknown:<uuid>' sentinel — the migration's convention — so distinct
//    email-less leads never collapse into one shared customer row.
//
// 2. Job insert with id = row.job_id (NEVER upsert — the public route must
//    not be able to overwrite an existing job). On a 23505 PK conflict (a
//    client retried with a used UUID; the sheet would have appended a
//    duplicate row), retry ONCE with a fresh server randomUUID(), stashing
//    the original id as legacy: { original_job_id } and logging a warn.
//
// Returns { rowNumber: 0 }: rowNumber is a sheet concept (callers only use
// it as a React key / log label); 0 is the sheet's own "could not determine
// row number" sentinel.
export async function appendContactRow(row: ContactRow): Promise<{ rowNumber: number }> {
  const client = getSupabaseClient()

  const email = (row.email ?? '').trim()
  const name = row.name ?? ''
  const phone = row.phone ?? ''
  const customerPayload: { email: string; name?: string; phone?: string } = {
    email: email === '' ? `unknown:${randomUUID()}` : email,
  }
  if (name !== '') customerPayload.name = name
  if (phone !== '') customerPayload.phone = phone

  const { data: customer, error: customerError } = await client
    .from('customers')
    .upsert(customerPayload, { onConflict: 'email' })
    .select('id')
    .single()
  if (customerError || !customer) {
    throw new Error(
      `pg/repo: customer upsert failed: ${customerError?.message ?? 'no row returned'}`,
    )
  }

  const jobInsert = { ...toDbInsert(row), customer_id: customer.id as string }
  const { error: jobError } = await client.from('jobs').insert(jobInsert)
  if (jobError && jobError.code === '23505') {
    const retryId = randomUUID()
    logger.warn(
      { originalJobId: jobInsert.id, retryJobId: retryId },
      'pg/repo: jobs PK conflict on insert — retrying once with a fresh UUID',
    )
    const { error: retryError } = await client.from('jobs').insert({
      ...jobInsert,
      id: retryId,
      legacy: { original_job_id: jobInsert.id },
    })
    if (retryError) {
      throw new Error(`pg/repo: jobs insert retry failed: ${retryError.message}`)
    }
  } else if (jobError) {
    throw new Error(`pg/repo: jobs insert failed: ${jobError.message}`)
  }

  return { rowNumber: 0 }
}

export async function findRowByJobId(
  jobId: string,
): Promise<{ rowNumber: number; row: ContactRow } | null> {
  // Sheet parity: falsy/garbage jobId found no row; uuid-typed pg would throw
  // 22P02 instead — gate before querying. (Admin 404 pages, malformed Stripe
  // metadata and Telegram callbacks all rely on the null sentinel.)
  if (!isUuid(jobId)) return null
  const client = getSupabaseClient()
  const { data, error } = await client.from('jobs').select('*').eq('id', jobId).maybeSingle()
  if (error) throw new Error(`pg/repo: findRowByJobId query failed: ${error.message}`)
  if (!data) return null
  // rowNumber is synthetic in pg (sheet row numbers don't exist); callers
  // only use it as a React key / label, and 0 matches the append sentinel.
  return { rowNumber: 0, row: toContactRow(data as DbJob) }
}

export async function updateRowByJobId(
  jobId: string,
  updates: ContactRowPartial,
): Promise<{ updated: boolean; rowNumber?: number }> {
  if (!isUuid(jobId)) return { updated: false }
  const client = getSupabaseClient()

  const dbUpdate = toDbUpdate(updates)
  if (Object.keys(dbUpdate).length === 0) {
    // Sheet parity: an empty update short-circuited to { updated: true }
    // after the find, without any write. Mirror that with an existence check.
    const { data, error } = await client.from('jobs').select('id').eq('id', jobId).maybeSingle()
    if (error) throw new Error(`pg/repo: updateRowByJobId existence check failed: ${error.message}`)
    return data ? { updated: true } : { updated: false }
  }

  const { data, error } = await client.from('jobs').update(dbUpdate).eq('id', jobId).select('id')
  if (error) throw new Error(`pg/repo: updateRowByJobId update failed: ${error.message}`)
  // Valid-but-absent UUID: zero rows updated — same silent no-op as the sheet.
  return data && data.length > 0 ? { updated: true } : { updated: false }
}

// NEW surface member (no sheet counterpart — the sheet had no customers
// table; lib/data/index.ts returns { updated: false } in sheet mode). Called
// by the data-requests anonymize action after its per-job redaction loop.
// PII fields -> '[REDACTED]', notes -> '' (free text, may embed PII), email
// -> unique 'redacted:<uuid>' sentinel (keeps the citext unique index happy
// across multiple redactions), anonymized_at = now. citext .eq() makes the
// match case-insensitive, same as the sheet's trim+lowercase email matching.
export async function redactCustomerByEmail(email: string): Promise<{ updated: boolean }> {
  const trimmed = (email ?? '').trim()
  if (trimmed === '') return { updated: false }
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('customers')
    .update({
      name: REDACTED,
      phone: REDACTED,
      notes: '',
      email: `redacted:${randomUUID()}`,
      anonymized_at: new Date().toISOString(),
    })
    .eq('email', trimmed)
    .select('id')
  if (error) throw new Error(`pg/repo: redactCustomerByEmail update failed: ${error.message}`)
  // No match (already redacted, or never existed) is a graceful no-op.
  return { updated: (data?.length ?? 0) > 0 }
}

// NEW surface member (no sheet counterpart — the sheet had no `legacy` column).
// The migration stashes each job's COMPLETE raw sheet row into jobs.legacy
// (name/phone/email/address/description + any kept-first duplicate rows), which
// the per-job ANONYMIZED_FIELDS update CANNOT reach (legacy isn't a ContactRow
// field, so toDbUpdate would reject it). Without this, a customer's original
// PII would survive a deletion request in jobs.legacy AND be re-emitted in the
// daily backup CSV (lib/data/pg/export.ts includes the legacy column). The
// anonymize action calls this with the exact job ids it just redacted — we
// null the whole blob (rowNumber is a migration-debug aid, not worth keeping
// against a PII-retention risk). Matched by id, NOT email, because the loop has
// already overwritten jobs.email with '[REDACTED]' by the time this runs.
export async function redactJobLegacyByIds(jobIds: string[]): Promise<{ updated: number }> {
  const ids = jobIds.filter((id) => isUuid(id))
  if (ids.length === 0) return { updated: 0 }
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('jobs')
    .update({ legacy: null })
    .in('id', ids)
    .select('id')
  if (error) throw new Error(`pg/repo: redactJobLegacyByIds update failed: ${error.message}`)
  return { updated: data?.length ?? 0 }
}
