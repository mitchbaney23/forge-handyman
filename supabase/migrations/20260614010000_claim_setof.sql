-- Forge Handyman — Stage 14 (Phase B2) fix: claim_charge_attempt return shape
--
-- The original `returns payments` (a single composite) returns a row of ALL
-- NULL fields on ON CONFLICT DO NOTHING via PostgREST — which a caller can
-- mistake for "I won the gate" (a double-charge hazard). `returns setof
-- payments` returns a clean empty array on conflict and [row] on insert, so the
-- "did I win?" check is unambiguous. (The caller also hardens by checking
-- row.id, but this makes the contract correct at the source.)

drop function if exists claim_charge_attempt(uuid, text, integer, text, text);

create function claim_charge_attempt(
  p_job_id   uuid,
  p_purpose  text,
  p_amount   integer,
  p_key      text,
  p_customer text
) returns setof payments
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
