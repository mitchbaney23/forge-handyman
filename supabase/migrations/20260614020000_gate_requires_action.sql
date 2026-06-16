-- Forge Handyman — Stage 14 (Phase B2) fix: hold 3DS attempts inside the gate
--
-- The partial unique index + claim function only covered ('pending','succeeded').
-- A 3DS balance charge resolves to 'requires_action', which DROPPED the guard
-- row out of the index — opening the gate. Within 24h the deterministic Stripe
-- key still blocked a real double-charge, but AFTER 24h (an un-authenticated
-- 3DS attempt) the key expires and a re-click could charge the card twice.
-- Including 'requires_action' keeps the row held until the webhook terminalizes
-- it (succeeded/failed) once the customer authenticates or the attempt lapses.

drop index if exists payments_live_attempt_uniq;
create unique index payments_live_attempt_uniq
  on payments (job_id, purpose)
  where status in ('pending', 'succeeded', 'requires_action');

-- The claim function's ON CONFLICT predicate must match the index predicate
-- exactly for arbiter inference, so recreate it.
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
  on conflict (job_id, purpose) where status in ('pending', 'succeeded', 'requires_action')
  do nothing
  returning *;
$$;

revoke all on function claim_charge_attempt(uuid, text, integer, text, text)
  from public, anon, authenticated;
