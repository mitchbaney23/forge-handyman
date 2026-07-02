import { getSupabaseClient } from '@/lib/data/pg/client'
import { isUuid } from '@/lib/data/pg/mappers'

// Postgres payments layer — Stage 14 (Phase B2). The payments table is the
// DURABLE double-charge guard for markComplete (Stripe idempotency keys expire
// at 24h, then re-charge). A partial unique index allows at most one live
// (pending|succeeded) attempt per (job_id, purpose); the claim_charge_attempt
// RPC inserts a pending row or returns nothing on conflict — "nothing" is the
// gate. See supabase/migrations/20260614000000_payments_guard.sql.
//
// Postgres-only: in sheet mode the dispatch layer (lib/data/index.ts) no-ops,
// and markComplete keeps its pre-B2 best-effort behavior.

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'requires_action'

export interface PaymentRow {
  id: string
  jobId: string
  purpose: string
  status: string
  amountCents: number | null
  stripePaymentIntentId: string
  stripeChargeId: string
  stripeCustomerId: string
  idempotencyKey: string
  error: string
  createdAt: string
}

interface DbPaymentRow {
  id: string
  job_id: string | null
  purpose: string | null
  status: string | null
  amount_cents: number | null
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_customer_id: string | null
  idempotency_key: string | null
  error: string | null
  created_at: string | null
}

function mapPaymentRow(row: DbPaymentRow): PaymentRow {
  return {
    id: row.id,
    jobId: row.job_id ?? '',
    purpose: row.purpose ?? '',
    status: row.status ?? '',
    amountCents: row.amount_cents,
    stripePaymentIntentId: row.stripe_payment_intent_id ?? '',
    stripeChargeId: row.stripe_charge_id ?? '',
    stripeCustomerId: row.stripe_customer_id ?? '',
    idempotencyKey: row.idempotency_key ?? '',
    error: row.error ?? '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
  }
}

// Atomically claim a charge attempt. Returns the new pending row when this call
// WON the gate, or null when a live (pending|succeeded) attempt already exists
// (the caller must NOT charge — reconcile via findLiveAttempt instead).
export async function claimChargeAttempt(args: {
  jobId: string
  purpose: string
  amountCents: number
  idempotencyKey: string
  stripeCustomerId: string
}): Promise<PaymentRow | null> {
  if (!isUuid(args.jobId)) return null
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('claim_charge_attempt', {
    p_job_id: args.jobId,
    p_purpose: args.purpose,
    p_amount: args.amountCents,
    p_key: args.idempotencyKey,
    p_customer: args.stripeCustomerId,
  })
  if (error) throw new Error(`pg/payments: claim_charge_attempt failed: ${error.message}`)
  // setof payments => [] on conflict, [row] on insert. Hardened against the
  // legacy single-composite shape (which returns an ALL-NULL row on conflict):
  // a real claimed row always has an id, the conflict sentinel does not. Only a
  // row with a real id means WE won the gate — anything else is null (= a live
  // attempt already exists, do NOT charge).
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as DbPaymentRow[]
  const row = rows.find((r) => r && r.id) ?? null
  return row ? mapPaymentRow(row) : null
}

// The current live attempt for (job_id, purpose), if any.
export async function findLiveAttempt(
  jobId: string,
  purpose: string,
): Promise<PaymentRow | null> {
  if (!isUuid(jobId)) return null
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('payments')
    .select('*')
    .eq('job_id', jobId)
    .eq('purpose', purpose)
    // Must mirror the gate index predicate — a 3DS attempt is held too.
    .in('status', ['pending', 'succeeded', 'requires_action'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`pg/payments: findLiveAttempt failed: ${error.message}`)
  const row = (data?.[0] ?? null) as DbPaymentRow | null
  return row ? mapPaymentRow(row) : null
}

// Update a specific attempt row's outcome (by its id) — used by markComplete
// right after the synchronous Stripe call returns. A 'failed' status drops the
// row out of the partial unique, freeing a future retry.
export async function recordPaymentOutcome(
  paymentId: string,
  outcome: {
    status: PaymentStatus
    stripePaymentIntentId?: string
    stripeChargeId?: string
    error?: string
  },
): Promise<void> {
  const client = getSupabaseClient()
  const patch: Record<string, unknown> = { status: outcome.status }
  if (outcome.stripePaymentIntentId) patch.stripe_payment_intent_id = outcome.stripePaymentIntentId
  if (outcome.stripeChargeId) patch.stripe_charge_id = outcome.stripeChargeId
  if (outcome.error !== undefined) patch.error = outcome.error
  const { error } = await client.from('payments').update(patch).eq('id', paymentId)
  if (error) throw new Error(`pg/payments: recordPaymentOutcome failed: ${error.message}`)
}

// Reconcile the live attempt for a job from the authoritative Stripe webhook:
// move the pending row to its terminal state + stamp the Stripe ids. Idempotent
// (a second webhook delivery is a no-op once the row is already terminal). If
// no pending row exists (e.g. the attempt predates B2), this is a safe no-op —
// the webhook still owns the job-status flip independently.
export async function reconcileAttempt(
  jobId: string,
  purpose: string,
  outcome: {
    status: PaymentStatus
    stripePaymentIntentId?: string
    stripeChargeId?: string
    error?: string
  },
): Promise<void> {
  if (!isUuid(jobId)) return
  const client = getSupabaseClient()
  const patch: Record<string, unknown> = { status: outcome.status }
  if (outcome.stripePaymentIntentId) patch.stripe_payment_intent_id = outcome.stripePaymentIntentId
  if (outcome.stripeChargeId) patch.stripe_charge_id = outcome.stripeChargeId
  if (outcome.error !== undefined) patch.error = outcome.error
  const { error } = await client
    .from('payments')
    .update(patch)
    .eq('job_id', jobId)
    .eq('purpose', purpose)
    // Terminalize any live non-terminal attempt (pending OR an in-flight 3DS).
    // Idempotent: a second webhook delivery against an already-terminal row
    // matches nothing.
    .in('status', ['pending', 'requires_action'])
  if (error) throw new Error(`pg/payments: reconcileAttempt failed: ${error.message}`)
}

// Recent payment rows for the admin metrics strip (revenue math happens in
// lib/admin/metrics.ts). Bounded by created_at, small at this volume.
export async function listPaymentsSince(sinceIso: string): Promise<
  { purpose: string; status: string; amountCents: number | null; createdAt: string }[]
> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('payments')
    .select('purpose,status,amount_cents,created_at')
    .gte('created_at', sinceIso)
  if (error) throw new Error(`pg/payments: listPaymentsSince failed: ${error.message}`)
  return ((data ?? []) as Pick<DbPaymentRow, 'purpose' | 'status' | 'amount_cents' | 'created_at'>[]).map(
    (row) => ({
      purpose: row.purpose ?? '',
      status: row.status ?? '',
      amountCents: row.amount_cents,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    }),
  )
}

// Succeeded money-in rows for a job (deposit + balance-charge) — what the
// admin refund UI offers to send back. Ordered oldest-first so the deposit
// lists before the balance.
export async function listRefundablePayments(jobId: string): Promise<PaymentRow[]> {
  if (!isUuid(jobId)) return []
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('payments')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'succeeded')
    .in('purpose', ['deposit', 'balance-charge'])
    .order('created_at', { ascending: true })
  if (error) throw new Error(`pg/payments: listRefundablePayments failed: ${error.message}`)
  return ((data ?? []) as DbPaymentRow[]).map(mapPaymentRow)
}

// Record a non-guarded payment event (deposit collected via the hosted checkout
// link, or a refund) for the financial ledger / future LTV. No conflict gate —
// these aren't re-chargeable from our side. Best-effort: never the thing that
// fails a webhook, so callers wrap it.
export async function recordPayment(args: {
  jobId: string
  purpose: string
  status: string
  amountCents: number | null
  stripePaymentIntentId?: string
  stripeChargeId?: string
  stripeCustomerId?: string
}): Promise<void> {
  if (!isUuid(args.jobId)) return
  const client = getSupabaseClient()
  const { error } = await client.from('payments').insert({
    job_id: args.jobId,
    purpose: args.purpose,
    status: args.status,
    amount_cents: args.amountCents,
    stripe_payment_intent_id: args.stripePaymentIntentId ?? '',
    stripe_charge_id: args.stripeChargeId ?? '',
    stripe_customer_id: args.stripeCustomerId ?? '',
  })
  if (error) throw new Error(`pg/payments: recordPayment failed: ${error.message}`)
}

// One ledger row per refunded charge. charge.refunded webhooks report a
// CUMULATIVE amount_refunded, so a second partial refund (or a re-delivery
// after the dedup TTL) must REPLACE the existing row's amount, not insert a
// second row — LTV subtracts refund rows from collected revenue, and two
// cumulative rows would double-count. Read-then-write is enough here: the
// webhook idempotency layer serializes deliveries, and this ledger is
// best-effort by contract (callers wrap it).
export async function recordRefund(args: {
  jobId: string
  amountRefundedCents: number
  stripeChargeId: string
  stripePaymentIntentId?: string
}): Promise<void> {
  if (!isUuid(args.jobId)) return
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('payments')
    .select('id')
    .eq('job_id', args.jobId)
    .eq('purpose', 'refund')
    .eq('stripe_charge_id', args.stripeChargeId)
    .limit(1)
  if (error) throw new Error(`pg/payments: recordRefund lookup failed: ${error.message}`)
  const existing = (data?.[0] ?? null) as { id: string } | null
  if (existing) {
    const { error: updateError } = await client
      .from('payments')
      .update({ amount_cents: args.amountRefundedCents })
      .eq('id', existing.id)
    if (updateError) throw new Error(`pg/payments: recordRefund update failed: ${updateError.message}`)
    return
  }
  const { error: insertError } = await client.from('payments').insert({
    job_id: args.jobId,
    purpose: 'refund',
    status: 'succeeded',
    amount_cents: args.amountRefundedCents,
    stripe_payment_intent_id: args.stripePaymentIntentId ?? '',
    stripe_charge_id: args.stripeChargeId,
    stripe_customer_id: '',
  })
  if (insertError) throw new Error(`pg/payments: recordRefund insert failed: ${insertError.message}`)
}
