-- Forge Handyman — Phase C: appointments + self-scheduling
--
-- Customers self-schedule a real slot from a technician's calendar-driven
-- availability (their @forgehandyman.com Google Calendar). This adds:
--   * technician calendar identity columns (per-employee model),
--   * an `appointments` table (one row per booked slot),
--   * a partial-unique-index + `claim_slot()` guard that mirrors the payments
--     double-charge guard — the atomic anti-double-booking layer.
-- `jobs` is NOT ALTERed for scheduling (per the Phase C design).

-- Calendar identity: the @forgehandyman.com account the service account
-- impersonates (domain-wide delegation) to read availability/free-busy, plus an
-- optional dedicated availability-calendar id if the tech keeps open windows on
-- a separate calendar.
alter table technicians
  add column if not exists calendar_email text not null default '',
  add column if not exists availability_calendar_id text not null default '';

create table appointments (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  job_id          uuid references jobs(id),
  technician_id   uuid not null references technicians(id),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  status          text not null default 'Booked',  -- app-enforced (Booked/Cancelled), no CHECK
  google_event_id text not null default '',         -- for later reschedule/cancel
  source          text not null default 'self-serve'
);

create trigger appointments_set_updated_at
  before update on appointments
  for each row execute function set_updated_at();

-- At most one LIVE (Booked) appointment per technician + start instant — the
-- atomic anti-double-booking gate. 'Cancelled' drops out so the slot frees.
create unique index appointments_live_slot_uniq
  on appointments (technician_id, starts_at)
  where status = 'Booked';

create index appointments_starts_at_idx on appointments (starts_at);
create index appointments_job_id_idx on appointments (job_id);

-- RLS enabled, no policies — service-role only, matching every other table.
alter table appointments enable row level security;

-- Atomic slot claim, mirroring claim_charge_attempt: insert-or-nothing, returns
-- setof so [] = lost the race and [row] = won (the caller also checks row.id).
-- The ON CONFLICT predicate must match the index predicate exactly for arbiter
-- inference.
create function claim_slot(
  p_job_id uuid,
  p_tech   uuid,
  p_starts timestamptz,
  p_ends   timestamptz,
  p_event  text
) returns setof appointments
language sql
as $$
  insert into appointments (job_id, technician_id, starts_at, ends_at, google_event_id)
  values (p_job_id, p_tech, p_starts, p_ends, p_event)
  on conflict (technician_id, starts_at) where status = 'Booked'
  do nothing
  returning *;
$$;

revoke all on function claim_slot(uuid, uuid, timestamptz, timestamptz, text)
  from public, anon, authenticated;
