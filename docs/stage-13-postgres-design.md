# Stage 13 — Postgres Foundation: Design Spec

Date: 2026-06-12
Status: v2 — revised after a four-lens adversarial critique (parity, migration,
ops, architecture). Every change from v1 is a critique finding; the panel's
full findings are preserved in the PR description.

Phase A of the CRM build: swap the data layer from Google Sheets to Supabase
Postgres behind a feature flag, with zero user-visible behavior change.

## Goals

1. **Behavioral parity.** Every flow (contact intake, Stripe webhooks, Telegram
   dispatch, admin actions, crons, unsubscribe, data-rights) works identically
   on either backend. The all-strings `ContactRow` contract is preserved at the
   repo boundary.
2. **Safe cutover.** `DATA_BACKEND=sheet` (default) | `postgres`. Cutover and
   rollback are defined procedures (see runbook), not bare flag flips.
3. **Foundation for Phases B–F.** Normalized customers, an `activities` table
   that supersedes the Audit tab (and later doubles as the AI activity log),
   plus empty-but-designed tables for technicians, catalog, quotes, payments.
4. **LOB-portable.** Nothing in the schema names David or handyman work; no
   business-process enums baked into DDL (statuses are app-enforced).

## Non-goals (Phase A)

- No new features, no UI changes, no status-machine fixes.
- Faithfully ported quirks (NOT silently improved): at-most-once webhook
  semantics, `isSameLocalDay` UTC bucketing, any→any status transitions,
  duplicate submissions creating duplicate jobs.
- **Phase-plan corrections recorded for later phases** (from critique):
  - Phase B's markComplete fix needs DB-side atomicity via RPC **plus** a
    charge-attempt record — the `payments` table gets its first writes in
    Phase B (charge attempts), not Phase F. The RPC cannot wrap the Stripe
    HTTP call; it guards with `UPDATE … WHERE status <> 'Complete'`.
  - Phase C adds an `appointments` table (job_id, technician_id, time window)
    + a dispatch-recipient column; `jobs` is not ALTERed for scheduling.
  - Phase D must version Stripe idempotency keys (`quote-link:<jobId>:<quoteId>`)
    — the current `quote-link:<jobId>` scheme allows ONE link per job ever —
    and define the quotes→jobs money-column sync rule. `jobs.*_cents` stays
    authoritative through Phase C.

## Datastore: Supabase Postgres via `@supabase/supabase-js`

- Server-only client, lazy singleton. `SUPABASE_URL` +
  `SUPABASE_SERVICE_ROLE_KEY` (Sensitive — explicitly called out in
  .env.example since the name lacks SECRET/TOKEN; a secretlint pattern rule
  for `sb_secret_`/service-role JWTs is added). Throws helpfully when unset.
- **Backend selection:** `getBackend()` in `lib/data/backend.ts`, read
  **per call**: unset/`'sheet'` → sheet, `'postgres'` → postgres, anything
  else **throws** (fail-loud tier). `/api/health` reports the resolved
  backend in its JSON so the cutover flip is verifiable.
- **Pagination contract:** PostgREST caps responses (default 1000 rows).
  Every multi-row read (`listJobs`, exports, migration verify) MUST loop
  `.range(offset, offset+PAGE-1)` with a stable `.order(...)` until a short
  page returns. Unit-tested with a >1000-row mock.
- RLS **enabled on every table, no policies** (service-role bypasses; a
  leaked anon key reads nothing). schema.sql contains the actual
  `alter table … enable row level security` statements, the `citext`
  extension, and the `updated_at` trigger function + per-table triggers.

## Schema (db/schema.sql, run once in the Supabase SQL editor)

Changes from v1 are annotated.

```sql
create extension if not exists citext;
-- + set_updated_at() trigger fn; triggers on customers/jobs; RLS enables (full DDL in file)

create table customers (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  name          text not null default '',
  phone         text not null default '',
  email         citext not null,              -- sentinels: 'redacted:<uuid>' / 'unknown:<uuid>'
  notes         text not null default '',
  anonymized_at timestamptz
  -- v1's address / opt_out / stripe_customer_id DROPPED: each had no Phase A
  -- write path and would ship as a plausible-looking stale mirror (critique:
  -- opt_out compliance trap; address was job-site, wrong for landlords).
  -- Phase B adds them WITH their write paths.
);
create unique index customers_email_uniq on customers (email);  -- citext ⇒ case-insensitive

create table jobs (
  id    uuid primary key,                     -- legacy job_id (UUID v4)
  customer_id uuid not null references customers(id),
  -- … all 36 sheet-parity columns as v1, with these corrections:
  email                citext not null default '',   -- citext: .eq() matches case-insensitively (parity with trim+lower matching)
  review_send_count    integer,              -- nullable: NULL ↔ '' uniformly (was NOT NULL 0)
  prior_job_count      integer,              -- nullable: same
  status               text not null default 'New',  -- NO CHECK: app-enforced
                                              -- (VALID_STATUSES) — keeps status
                                              -- sets out of DDL for LOB reuse
  hours_to_first_touch numeric generated always as
    (extract(epoch from (first_touch_sent_at - submitted_at)) / 3600.0) stored,
                                              -- replaces the Sheet ARRAYFORMULA
  legacy               jsonb,                 -- raw sheet row + discarded duplicates
  anonymized_at        timestamptz            -- backfilled where email = '[REDACTED]'
);
-- indexes: status, submitted_at desc, email (plain — citext handles case),
-- customer_id, complete_date

create table activities (
  id     bigint generated always as identity primary key,
  at     timestamptz not null default now(),
  actor  text not null,
  action text not null,
  target text not null default '',
  before text, after text, notes text,
  job_id uuid,    -- NO foreign key (critique: an append-only log must never
                  -- fail a write on referential grounds — audit rows for
                  -- not-yet/never-existing jobs are a real webhook path).
                  -- pg/audit.ts sets it whenever target parses as a UUID.
  data   jsonb    -- opportunistic JSON.parse of before/after (new writes AND
                  -- migration) so Stripe IDs are queryable before Phase D/F
);
-- indexes: at desc, job_id, action

-- technicians / catalog_items / quotes / payments: as v1, except
-- quotes.status convention documented to match jobs (app-enforced text).
```

## Repo layer

```
lib/data/
  backend.ts      -- getBackend(): 'sheet' | 'postgres', throws on garbage
  index.ts        -- per-call switch; THE import for all call sites
  pg/client.ts    -- lazy singleton supabase client
  pg/mappers.ts   -- DB row ↔ all-strings ContactRow (parity-critical)
  pg/repo.ts      -- appendContactRow, findRowByJobId, updateRowByJobId, redactCustomerByEmail
  pg/queries.ts   -- listJobs (paginated), findPriorJobsByEmail, countDuplicateLeadsLast24h
  pg/audit.ts     -- appendAuditRow → activities; ensureAuditTab → no-op
  pg/export.ts    -- exportAllTabsCsv: customers/jobs/activities → CSV (paginated)
```

**Mapper conventions** (enforced by round-trip unit tests):
- booleans: `true` ↔ `'true'`, `false` ↔ `''`
- money/counts (ALL of them, incl. review_send_count/prior_job_count):
  `NULL` ↔ `''`; `n` ↔ `String(n)` (preserves `'' ≠ '0'`)
- timestamps: **normalized through `new Date(v).toISOString()`** on read, so
  pg output is byte-identical to sheet-written values (PostgREST's
  `+00:00`/microseconds format never escapes the mapper — lexicographic
  comparisons in queries.ts/pipeline depend on this)
- `preferred_date`: date ↔ `'YYYY-MM-DD'`; `NULL` ↔ `''`
- arrays: text[] ↔ comma-joined; `{}` ↔ `''`
- `hours_to_first_touch`: read-only (generated column) — mapper NEVER writes it
- emails: trimmed at the write boundary (zod already trims; legacy rows are
  trimmed at migration) — with citext this makes `.eq()` equal the sheet's
  trim+lowercase matching
- `rowNumber`: synthetic (list index + 2); React keys only

**Repo contracts** (each is a critique finding; each gets a unit test):
- Any jobId that is not a valid UUID → `findRowByJobId` returns `null`,
  `updateRowByJobId` returns `{updated:false}` — never a 22P02 throw.
  (Admin 404 pages, malformed Stripe metadata, Telegram callbacks depend on it.)
- `updateRowByJobId` on a valid-but-absent UUID: same silent no-op as sheet.
- `appendContactRow`: customer step is a **real upsert**
  (`onConflict: 'email'`, requires the unique index) — refreshes name/phone
  when the incoming values are non-empty (newest-wins, matching migration);
  never writes columns it doesn't own. Job insert: on PK conflict (client
  retried with a used UUID — sheet behavior was "append a duplicate row"),
  retry ONCE with a fresh server UUID, original id stashed in `legacy`,
  warn-logged. **Never upsert jobs from the public route.**
- `redactCustomerByEmail(email)` — NEW surface member: pg impl redacts the
  customers row (name/phone/notes → `[REDACTED]`/`''`, email →
  `redacted:<uuid>` sentinel, anonymized_at = now()); sheet impl is a no-op.
  Called by the data-requests action after its per-job loop, and covered by a
  test asserting no table returns PII post-anonymization.
- `appendAuditRow`: also sets `activities.job_id` when target is UUID-shaped
  (even if no such job exists), and opportunistically parses before/after
  JSON into `data`.

Call sites change imports `@/lib/sheet/{repo,queries,audit-log,export}` →
`@/lib/data`. Type-only imports may stay (types re-exported from both).
`app/admin/setup-sheet/*` + `scripts/setup-sheet.ts` stay sheet-coupled but
the page/action are **gated on `getBackend() === 'sheet'`** — in postgres mode
they render/return a "retired — backend is Postgres" notice (also retires
that action's missing rate limit).

## Health route

- Response JSON gains `backend: getBackend()`.
- `checkEnvVars`: GOOGLE_SHEET_ID required only in sheet mode;
  SUPABASE_URL/SERVICE_ROLE_KEY required only in postgres mode
  (Gmail/Calendar Google vars stay unconditional).
- Connectivity checks: **only the active backend's check can fail the route.**
  The inactive backend, if configured, reports `skipped`. (Critique: rollback
  must be able to go green while Supabase is down, and staged vars must not
  page production.)

## Backup continuity

`backup-sheet` cron keeps name/schedule/auth. In postgres mode:
- `exportAllTabsCsv()` exports customers/jobs/activities (paginated, ordered).
- Email subject/body branch: "Forge DB Backup", restore instructions point at
  Supabase CSV import — NOT "paste into the master sheet" (which would
  restore into the abandoned backend).
- Route declares `maxDuration = 60`.
- The Google Sheet is NOT mirrored post-cutover (Supabase table editor +
  daily CSV email replace it). Gmail's 25MB attachment ceiling is the
  long-term bound; revisit in Phase F.

## Migration script: `scripts/migrate-sheet-to-db.ts`

Modes: **dry-run (default)** → validation report only; `--execute` → migrate;
`--verify` → post-cutover diff of every sheet row against pg (the rollback /
lost-write detector).

- **Idempotency = wipe-and-reload**: `--execute` starts with
  `TRUNCATE customers, jobs, activities RESTART IDENTITY CASCADE` (via a
  single SQL RPC defined in schema.sql). A crashed run is always recoverable
  by re-running. `--execute` REFUSES to run when `DATA_BACKEND=postgres`
  (post-flip safety) without `--force`.
- **Sheets FORMATTED_VALUE artifacts** (critique blocker — the cells were
  written USER_ENTERED and coerced by Sheets):
  - booleans: truthy iff `trim().toLowerCase() === 'true'` ('TRUE' cells!) —
    anything else falsy; non-empty non-true values listed in the report
  - cents/counts: strip thousands separators, then `/^\d+$/` or fail loudly
  - phones: digits-only 11-digit-leading-1 → `+` prefixed; 10-digit → `+1`
    prefixed; anything else kept raw + reported (Sheets eats `+` signs)
  - `preferred_date`: ISO `YYYY-MM-DD` accepted; `M/D/YYYY` normalized;
    else fail loudly
  - timestamps: must parse via `new Date()`; empty `submitted_at` fails
    loudly (NOT NULL); statuses trimmed before validation and stored trimmed
- **Validator checks every constraint the schema enforces** (NOT NULLs, FK
  resolvability, UUID shapes) over ALL rows BEFORE the first write.
- Customers: group by `lower(trim(email))`; newest row wins name/phone;
  `[REDACTED]` **and empty emails** get one customer per row with sentinel
  emails (`redacted:<uuid>` / `unknown:<uuid>`) + `anonymized_at` set for
  redacted ones; `jobs.anonymized_at` backfilled where email = `[REDACTED]`.
- **Duplicate job_ids: keep FIRST occurrence** (matches `findRowByJobId`
  first-match read semantics — the first row is the one webhooks updated),
  discarded duplicates stashed in the kept job's `legacy.duplicates[]`,
  prominently reported.
- Legacy rows missing job_id: deterministic UUIDv5 (namespace + row number +
  submitted_at + email) so IDs are stable across runs.
- Audit tab → activities with original timestamps; the script includes its own
  `readAuditRows()` (`values.get` on `Audit!A:G` — no read API exists in
  lib/sheet today); before/after parsed into `data` where they're valid JSON;
  `job_id` set where target is a UUID.
- Ends with sheet-vs-pg row counts + per-table spot-check diffs.

## Cutover runbook (full version goes in the progress doc)

1. Create Supabase project (region us-east-1, 2FA). **Plan: free tier is fine
   while building; upgrade to Pro at go-live cutover** — free projects pause
   after ~1 week of inactivity (an outage!) and have no automated backups;
   with real payment state, Pro's PITR + no-pause is the defensible choice.
   Run db/schema.sql in the SQL editor.
2. Env vars: **Production**: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
   (Sensitive) + later DATA_BACKEND=postgres. **Preview: DATA_BACKEND stays
   `sheet`; the production service-role key is NEVER added to Preview scope**
   (preview deployments serve the public form — they would write test leads
   into prod data). A second free Supabase project for previews is optional later.
3. **Freeze** (~15 min): set CONTACT_FORM_DISABLED=true,
   AUTOMATIONS_DISABLED=true, DISPATCH_DISABLED=true; disable the Stripe
   webhook endpoint in the dashboard (note: disabled-endpoint events are NOT
   auto-retried — they must be manually resent from the dashboard afterward).
4. `migrate-sheet-to-db.ts` dry-run → review report → `--execute` → verify counts.
5. Flip DATA_BACKEND=postgres (Production), redeploy, `/api/health` shows
   `backend: postgres` and all green.
6. Re-enable Stripe endpoint + **resend any events delivered/failed during
   the freeze window**; clear the three kill switches.
7. `migrate-sheet-to-db.ts --verify` → zero divergence expected (Telegram
   taps / unsubscribe clicks during the freeze are the known unfreezable
   writers — verify catches them).
8. Submit a test lead end-to-end; watch one Stripe webhook round-trip.
9. **Rollback policy (honest version):** flipping back to `sheet` is safe
   ONLY before the first postgres write, OR by repeating the freeze procedure
   in reverse — jobs created in the postgres window do not exist in the
   sheet, and webhook events for them are consumed at-most-once (Redis
   dedupe marks before processing) so their writes are otherwise silently
   lost. Stripe events from the mismatch window must be manually resent from
   the dashboard event log after any rollback.

## Tests + CI

- vitest: mapper round-trips (every convention, both directions); migration
  parser fixtures including `'TRUE'`, `'4,500'`, `'6/15/2026'`, plus-stripped
  phones; UUID-garbage repo contract; pagination >1000 mock; customer
  grouping (dedupe, sentinels, newest-wins); duplicate-job_id keep-first;
  post-anonymization no-PII assertion; CSV export format;
  `groupJobsForOverview` fixtures.
- `.github/workflows/ci.yml`: npm ci → typecheck → lint → test → build on PR
  + push to main. Node 20.

## Env vars (new)

| Var | Sensitive | Notes |
|---|---|---|
| `SUPABASE_URL` | No | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** (name lacks SECRET/TOKEN — flagged in .env.example) | server-only, bypasses RLS, Production scope ONLY |
| `DATA_BACKEND` | No | unset/`sheet` (default) \| `postgres`; any other value throws |

## Sheets backend sunset (declared 2026-07-02)

`DATA_BACKEND=postgres` has been live in production since the Stage 13
cutover, and every business-critical surface (CRM, payments ledger, scheduling,
activities) is postgres-only. The dual-backend dispatch in `lib/data/index.ts`
now only adds cost: every new feature pays a "port it to sheet mode or gate it"
tax.

**Policy, effective immediately:**

- **No new feature ships in sheet mode.** New surfaces are postgres-only behind
  `getBackend()` / `crmEnabled()` gates (the existing pattern).
- **Target removal: 2026-08-15** (~6 weeks of postgres-only prod behavior as
  the safety window). At that point delete `lib/sheet/`, the `DATA_BACKEND`
  switch, and the sheet branches in `lib/data/index.ts`.
- **Backup continuity:** the daily `/api/cron/backup-sheet` CSV-export email is
  backend-aware and stays — it exports the postgres tables after removal. The
  Google Sheet itself becomes a frozen archive; Supabase Pro (PITR) is the
  primary recovery story once enabled.
- The removal itself is a normal gated deploy: needs Mitch's explicit go, after
  a final CSV export is confirmed in the inbox.
