-- Forge Handyman — Stage 13 (Phase A): Postgres foundation
-- Run ONCE in the Supabase SQL editor (see docs/stage-13-postgres-design.md
-- and the cutover runbook). Postgres 15+ (gen_random_uuid is built in).
--
-- Design rules baked into this file:
--   * LOB-portable: no business-process enums in DDL — `status` columns are
--     plain text, enforced by the app (VALID_STATUSES). Intentionally NO CHECK.
--   * RLS is ENABLED on every table with NO policies: the server talks to
--     Postgres with the service-role key (bypasses RLS); a leaked anon key
--     can read nothing.
--   * All-strings ContactRow parity is handled in lib/data/pg/mappers.ts —
--     nullable numeric columns preserve the sheet's '' vs '0' distinction.

create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------

create table customers (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  name          text not null default '',
  phone         text not null default '',
  email         citext not null,  -- sentinels: 'redacted:<uuid>' / 'unknown:<uuid>'
  notes         text not null default '',
  anonymized_at timestamptz
  -- address / opt_out / stripe_customer_id deliberately absent in Phase A:
  -- each had no write path and would ship as a plausible-looking stale
  -- mirror. Phase B adds them WITH their write paths.
);

-- citext ⇒ case-insensitive uniqueness; required by the appendContactRow
-- upsert (onConflict: 'email').
create unique index customers_email_uniq on customers (email);

create trigger customers_set_updated_at
  before update on customers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- jobs — one row per lead, sheet-parity (all 36 ContactRow columns)
-- ---------------------------------------------------------------------------

create table jobs (
  id          uuid primary key,  -- legacy job_id (UUID v4; deterministic v5 for migrated rows that lacked one). No default: the app/migration always supplies it.
  customer_id uuid not null references customers(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Sheet1 parity columns (ContactRow order; job_id above as `id`)
  submitted_at             timestamptz not null,
  name                     text not null default '',
  phone                    text not null default '',
  email                    citext not null default '',  -- citext: .eq() matches case-insensitively (parity with the sheet's trim+lower matching)
  address                  text not null default '',
  service_type             text not null default '',
  preferred_date           date,
  description              text not null default '',
  referral_source          text not null default '',
  status                   text not null default 'New',  -- app-enforced (VALID_STATUSES); NO CHECK on purpose — keeps status sets out of DDL for LOB reuse
  complete_date            timestamptz,
  review_sent_at           timestamptz,
  review_send_count        integer,  -- nullable: NULL ↔ '' uniformly (preserves '' ≠ '0')
  review_received          boolean not null default false,
  seasonal_nudge_last_sent timestamptz,
  opt_out                  boolean not null default false,
  first_touch_sent_at      timestamptz,
  hours_to_first_touch     numeric generated always as
    (extract(epoch from (first_touch_sent_at - submitted_at)) / 3600.0) stored,
    -- replaces the Sheet ARRAYFORMULA; read-only — mappers never write it
  utm_source               text not null default '',
  stripe_customer_id       text not null default '',
  stripe_payment_method_id text not null default '',
  deposit_paid_cents       integer,  -- nullable: NULL ↔ ''. Authoritative money columns through Phase C (quotes sync rule lands in Phase D).
  balance_owed_cents       integer,  -- nullable: NULL ↔ ''
  service_categories       text[] not null default '{}',  -- comma-joined in the sheet
  property_type            text not null default '',
  urgency                  text not null default '',
  best_contact_time        text not null default '',
  best_contact_method      text not null default '',
  photo_urls               text[] not null default '{}',  -- comma-joined in the sheet, max 6
  is_returning_customer    boolean not null default false,
  prior_job_count          integer,  -- nullable: NULL ↔ ''
  dispatch_status          text not null default '',  -- Dispatched / Approved / Declined / Needs Sub — app-enforced, separate from `status`
  dispatch_decision        text not null default '',
  dispatch_decided_at      timestamptz,
  telegram_message_id      text not null default '',

  -- Migration bookkeeping
  legacy        jsonb,        -- raw sheet row + legacy.duplicates[] (discarded duplicate job_id rows)
  anonymized_at timestamptz   -- backfilled by migration where email = '[REDACTED]'; set by redactCustomerByEmail
);

create index jobs_status_idx        on jobs (status);
create index jobs_submitted_at_idx  on jobs (submitted_at desc);
create index jobs_email_idx         on jobs (email);  -- plain index — citext handles case
create index jobs_customer_id_idx   on jobs (customer_id);
create index jobs_complete_date_idx on jobs (complete_date);

create trigger jobs_set_updated_at
  before update on jobs
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- activities — append-only log; supersedes the Audit tab, later doubles as
-- the AI activity log (Phase E)
-- ---------------------------------------------------------------------------

create table activities (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  actor  text not null,
  action text not null,
  target text not null default '',
  before text,
  after  text,
  notes  text,
  job_id uuid,  -- intentionally NO foreign key: an append-only log must never
                -- fail a write on referential grounds — audit rows for
                -- not-yet/never-existing jobs are a real webhook path.
                -- pg/audit.ts sets it whenever target parses as a UUID.
  data   jsonb  -- opportunistic JSON.parse of before/after (new writes AND
                -- migration) so Stripe IDs are queryable before Phase D/F
);

create index activities_at_idx     on activities (at desc);
create index activities_job_id_idx on activities (job_id);
create index activities_action_idx on activities (action);

-- ---------------------------------------------------------------------------
-- Phase B–F tables: empty in Phase A, designed now so later phases add write
-- paths, not DDL. Statuses are app-enforced text (same convention as
-- jobs.status — Title Case, no CHECK). Money is integer cents.
-- ---------------------------------------------------------------------------

create table technicians (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  name             text not null,
  phone            text not null default '',
  email            citext not null default '',
  telegram_chat_id text not null default '',  -- dispatch recipient (Phase C generalizes beyond the single hardcoded chat)
  active           boolean not null default true,
  notes            text not null default ''
);
-- Phase C adds an `appointments` table (job_id, technician_id, time window)
-- + a dispatch-recipient column; `jobs` is NOT ALTERed for scheduling.

create table catalog_items (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  name             text not null,
  description      text not null default '',
  category         text not null default '',
  unit             text not null default '',  -- e.g. 'hour', 'each', 'sqft'
  unit_price_cents integer,
  active           boolean not null default true
);

create table quotes (
  id                     uuid primary key default gen_random_uuid(),
  created_at             timestamptz not null default now(),
  job_id                 uuid not null references jobs(id),
  status                 text not null default 'Draft',  -- app-enforced text, same convention as jobs.status (no CHECK, Title Case)
  line_items             jsonb,
  deposit_cents          integer,
  balance_cents          integer,
  total_cents            integer,
  stripe_payment_link_id text not null default '',  -- plink_…; Phase D backfills from activities.data
  sent_at                timestamptz,
  notes                  text not null default ''
  -- jobs.deposit_paid_cents / balance_owed_cents stay authoritative through
  -- Phase C; Phase D defines the quotes→jobs sync rule and versions Stripe
  -- idempotency keys (quote-link:<jobId>:<quoteId>).
);

create index quotes_job_id_idx on quotes (job_id);

create table payments (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),
  job_id                   uuid references jobs(id),
  quote_id                 uuid references quotes(id),
  purpose                  text not null default '',  -- e.g. 'deposit', 'balance-charge' — app-enforced
  status                   text not null default '',  -- charge-attempt state — app-enforced
  amount_cents             integer,
  currency                 text not null default 'usd',
  stripe_payment_intent_id text not null default '',
  stripe_charge_id         text not null default '',
  stripe_customer_id       text not null default '',
  idempotency_key          text not null default '',
  error                    text not null default '',
  data                     jsonb
  -- First writes land in Phase B: charge-attempt records guarding
  -- markComplete's double-charge race (with UPDATE … WHERE status <> 'Complete').
);

create index payments_job_id_idx on payments (job_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled everywhere, NO policies. The service-role key
-- bypasses RLS; anything else (e.g. a leaked anon key) reads/writes nothing.
-- ---------------------------------------------------------------------------

alter table customers     enable row level security;
alter table jobs          enable row level security;
alter table activities    enable row level security;
alter table technicians   enable row level security;
alter table catalog_items enable row level security;
alter table quotes        enable row level security;
alter table payments      enable row level security;

-- ---------------------------------------------------------------------------
-- Migration helper — wipe-and-reload idempotency for
-- scripts/migrate-sheet-to-db.ts (called via supabase.rpc('truncate_for_migration')).
--
-- !! DROP THIS FUNCTION after the cutover is verified: !!
--    drop function truncate_for_migration();
-- ---------------------------------------------------------------------------

create or replace function truncate_for_migration()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table customers, jobs, activities restart identity cascade;
end;
$$;

-- Functions default to EXECUTE for PUBLIC via PostgREST — without this revoke
-- a leaked anon key could wipe the database through the RPC endpoint.
revoke all on function truncate_for_migration() from public, anon, authenticated;
