# Stage 13 — Postgres Foundation (Phase A)

Date: 2026-06-12
Branch: `stage/13-postgres-foundation`

The data layer moves from Google Sheets to **Supabase Postgres behind a feature flag** — `DATA_BACKEND=sheet` (default) or `postgres` — with **zero user-visible behavior change**. Every flow (contact intake, Stripe webhooks, Telegram dispatch, admin actions, crons, unsubscribe, data-rights) works identically on either backend, and the cutover is a defined runbook, not a bare flag flip. Full design + critique findings: `docs/stage-13-postgres-design.md`.

---

## What shipped

### Schema
- **`db/schema.sql`** — run once in the Supabase SQL editor. `customers` (citext email + case-insensitive unique index, redaction sentinels), `jobs` (legacy UUID PKs, all 36 sheet-parity columns, `hours_to_first_touch` as a generated column replacing the Sheet ARRAYFORMULA, `legacy` jsonb for raw sheet rows + discarded duplicates), `activities` (supersedes the Audit tab; **no FK on `job_id`** so an append-only log never fails a write), plus empty-but-designed `technicians` / `catalog_items` / `quotes` / `payments`. RLS is **enabled on every table with no policies** (service-role bypasses; a leaked anon key reads nothing). `set_updated_at()` trigger fn + per-table triggers. Statuses are app-enforced text — no CHECK constraints, keeping business enums out of DDL.

### Data-layer switch
- **`lib/data/backend.ts`** — `getBackend()`: unset/`'sheet'` → sheet, `'postgres'` → postgres, anything else **throws** (fail-loud).
- **`lib/data/index.ts`** — per-call backend switch; THE import for all call sites (imports migrate from `@/lib/sheet/{repo,queries,audit-log,export}` → `@/lib/data`).
- **`lib/data/pg/client.ts`** — lazy-singleton Supabase client (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, server-only, throws helpfully when unset).
- **`lib/data/pg/mappers.ts`** — DB row ↔ all-strings `ContactRow`, parity-critical: booleans `true`↔`'true'`/`false`↔`''`, all numerics `NULL`↔`''` (preserves `'' ≠ '0'`), timestamps normalized through `new Date(v).toISOString()` so pg output is byte-identical to sheet-written values, arrays comma-joined, `hours_to_first_touch` read-only.
- **`lib/data/pg/repo.ts`** — `appendContactRow` (customer upsert on email, newest-wins; job PK conflict retries ONCE with a fresh UUID), `findRowByJobId` / `updateRowByJobId` (non-UUID input → `null` / `{updated:false}`, never a 22P02 throw), and new surface member `redactCustomerByEmail` (pg redacts the customers row; sheet impl is a no-op).
- **`lib/data/pg/queries.ts`** — `listJobs`, `findPriorJobsByEmail`, `countDuplicateLeadsLast24h`; every multi-row read loops `.range()` with a stable `.order()` past PostgREST's 1000-row cap.
- **`lib/data/pg/audit.ts`** — `appendAuditRow` → `activities`, setting `job_id` when the target is UUID-shaped and opportunistically parsing before/after JSON into `data`.
- **`lib/data/pg/export.ts`** — `exportAllTabsCsv`: customers/jobs/activities → CSV, paginated + ordered.
- **`app/admin/setup-sheet/*`** + `scripts/setup-sheet.ts` stay sheet-coupled but are **gated on `getBackend() === 'sheet'`** — in postgres mode they render/return a "retired — backend is Postgres" notice.

### Migration script
- **`scripts/migrate-sheet-to-db.ts`** — three modes: **dry-run (default)** validation report; `--execute` wipe-and-reload migrate (TRUNCATE … RESTART IDENTITY CASCADE via an RPC in schema.sql, so a crashed run is always recoverable; REFUSES to run when `DATA_BACKEND=postgres` without `--force`); `--verify` post-cutover diff of every sheet row against pg (the rollback / lost-write detector). Handles Sheets FORMATTED_VALUE artifacts (`'TRUE'` booleans, `'4,500'` cents, `M/D/YYYY` dates, plus-stripped phones), validates every schema constraint over ALL rows before the first write, groups customers by `lower(trim(email))` with newest-wins name/phone and sentinel emails for `[REDACTED]`/empty rows, keeps the FIRST occurrence of duplicate job_ids (discards stashed in `legacy.duplicates[]`), mints deterministic UUIDv5 ids for legacy rows missing job_id, and migrates the Audit tab → `activities` with original timestamps. Ends with sheet-vs-pg row counts + per-table spot-check diffs.

### Health + backup
- **`/api/health`** — response JSON gains `backend: getBackend()` so the cutover flip is verifiable. `checkEnvVars` requires `GOOGLE_SHEET_ID` only in sheet mode and `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` only in postgres mode. **Only the active backend's connectivity check can fail the route** — the inactive backend, if configured, reports `skipped` (rollback can go green while Supabase is down; staged vars don't page production).
- **`backup-sheet` cron** — keeps its name/schedule/auth. In postgres mode it emails "Forge DB Backup" with paginated CSVs of customers/jobs/activities and restore instructions pointing at Supabase CSV import (not "paste into the master sheet"). Route declares `maxDuration = 60`.

### Tests + CI
- **vitest** — mapper round-trips (every convention, both directions), migration parser fixtures (`'TRUE'`, `'4,500'`, `'6/15/2026'`, plus-stripped phones), UUID-garbage repo contract, >1000-row pagination mock, customer grouping (dedupe, sentinels, newest-wins), duplicate-job_id keep-first, post-anonymization no-PII assertion, CSV export format, `groupJobsForOverview` fixtures.
- **`.github/workflows/ci.yml`** — npm ci → typecheck → lint → test → build on every PR + push to main, Node 20.
- **Secret hygiene** — `.secretlintrc.json` gains pattern rules for Supabase secret keys (`sb_secret_…`) and service_role JWTs; `.env.example` documents that `SUPABASE_SERVICE_ROLE_KEY` must be marked Sensitive by hand (the name lacks SECRET/TOKEN).

---

## Mitch's one-time setup (cutover runbook)

1. [ ] **Create the Supabase project** (region us-east-1, enable 2FA). **Plan: free tier is fine while building; upgrade to Pro at go-live cutover** — free projects pause after ~1 week of inactivity (an outage!) and have no automated backups; with real payment state, Pro's PITR + no-pause is the defensible choice. Run `db/schema.sql` in the SQL editor.
2. [ ] **Env vars** — **Production**: `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (mark **Sensitive**) + later `DATA_BACKEND=postgres`. **Preview: `DATA_BACKEND` stays `sheet`; the production service-role key is NEVER added to Preview scope** (preview deployments serve the public form — they would write test leads into prod data). A second free Supabase project for previews is optional later.
3. [ ] **Freeze** (~15 min): set `CONTACT_FORM_DISABLED=true`, `AUTOMATIONS_DISABLED=true`, `DISPATCH_DISABLED=true`; disable the Stripe webhook endpoint in the dashboard (note: disabled-endpoint events are NOT auto-retried — they must be manually resent from the dashboard afterward).
4. [ ] **Migrate**: run `scripts/migrate-sheet-to-db.ts` dry-run → review the report → `--execute` → verify the row counts.
5. [ ] **Flip**: set `DATA_BACKEND=postgres` (Production), redeploy, confirm `/api/health` shows `backend: postgres` and all green.
6. [ ] **Thaw**: re-enable the Stripe endpoint + **resend any events delivered/failed during the freeze window**; clear the three kill switches.
7. [ ] **Verify**: run `scripts/migrate-sheet-to-db.ts --verify` → zero divergence expected (Telegram taps / unsubscribe clicks during the freeze are the known unfreezable writers — verify catches them).
8. [ ] **Smoke test**: submit a test lead end-to-end; watch one Stripe webhook round-trip.
9. [ ] **Know the rollback policy (honest version):** flipping back to `sheet` is safe ONLY before the first postgres write, OR by repeating the freeze procedure in reverse — jobs created in the postgres window do not exist in the sheet, and webhook events for them are consumed at-most-once (Redis dedupe marks before processing) so their writes are otherwise silently lost. Stripe events from the mismatch window must be manually resent from the dashboard event log after any rollback.

---

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean (2 pre-existing `ContactForm.tsx` warnings only) |
| `npm test` | 87 passing (4 files) |
| `npm run build` | clean — all 28 routes compile |
| `npm run secret-scan` | clean |
| Both backends: contact intake / webhooks / admin / crons parity | code-level parity verified (mappers + repo contracts unit-tested); live-pg parity is a cutover-day smoke test |
| Migration dry-run report reviewed | deferred to cutover (needs the real Sheet + a Supabase project) |

## Design review (pre-commit)

The diff went through a 5-lens adversarial review (parity / correctness / security /
spec-adherence / schema-migration), each finding independently verified. One **blocker**
fixed: the migration stashes each raw sheet row in `jobs.legacy`, which the anonymization
path could not reach — so a deletion request would have left PII in `legacy` and re-emitted
it in the daily backup CSV. Fixed by `redactJobLegacyByIds` (nulls `legacy` for the redacted
job ids; wired into the data-requests action; sheet-mode no-op). Three minors also fixed:
redacted-customer phone parity (`''` → `[REDACTED]` to match `redactCustomerByEmail`), an int4
overflow guard in `parseSheetCents` (catches >2³¹ cents in the dry-run instead of mid-INSERT),
and `activities` empty-→-NULL convention aligned between the live writer and the migration.
