-- Forge Handyman — Stage 14 (Phase B2): payments charge-attempt guard
--
-- The double-charge guard for markComplete. Stripe idempotency keys expire at
-- 24h (then re-charge), so the durable guard is a payments row claimed BEFORE
-- the Stripe call. A partial unique index allows AT MOST ONE live (pending or
-- succeeded) attempt per (job_id, purpose); a 'failed' attempt is excluded so a
-- genuine decline can be retried later.

create unique index if not exists payments_live_attempt_uniq
  on payments (job_id, purpose)
  where status in ('pending', 'succeeded');

-- Atomic claim: insert a 'pending' attempt, or do nothing if a live one already
-- exists. Returns the inserted row, or NO row on conflict — that "no row" IS
-- the gate (the caller must not charge). PostgREST's upsert can't target a
-- partial index, so this is an RPC. Service role bypasses RLS; revoke from the
-- public/anon/authenticated roles so a leaked anon key can't mint attempts.
create or replace function claim_charge_attempt(
  p_job_id   uuid,
  p_purpose  text,
  p_amount   integer,
  p_key      text,
  p_customer text
) returns payments
language sql
as $$
  insert into payments (job_id, purpose, status, amount_cents, idempotency_key, stripe_customer_id)
  values (p_job_id, p_purpose, 'pending', p_amount, p_key, p_customer)
  on conflict (job_id, purpose) where status in ('pending', 'succeeded')
  do nothing
  returning *;
$$;

revoke all on function claim_charge_attempt(uuid, text, integer, text, text)
  from public, anon, authenticated;
