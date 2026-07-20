# Forge Handyman — Session Log

## 2026-07-20 — New logo + real photos of David (branch `feat/new-logo-and-photos`)

Mitch supplied the new brand logo (orange outline anvil with house + hammer
cutout, from the brand-assets collab with his brother) and a photo of David
replacing an outdoor faucet. Swapped: `public/anvil.png` (header mark, now
923×444 transparent orange), `public/logo.png` (full lockup), `app/icon.png`
(transparent) + `app/apple-icon.png` (paper background — iOS renders
transparency as black), and `brand-assets/logo/exports/` (incl. new
`logo-transparent.png`). Filled all three photo placeholders with the real
photo: Hero work-order ticket (16:10 crop, `david-at-work.jpg`), homepage
"Why Forge" card, and About hero card (both 4:5 `david-portrait.jpg`; About
keeps the name/role caption strip + 40-years badge). Verified live in the
browser on all three spots. Mitch then sent two more photos — every spot now
has its own: hero ticket = faucet 16:10 (`david-at-work.jpg`), homepage
"Why Forge" = wiper-blade replacement (`david-wipers.jpg`, sits right by the
Auto Maintenance card), About hero = posed tree portrait w/ drill
(`david-tree.jpg`, Mitch's pick for "meet David"). The shared
`david-portrait.jpg` was removed. Also: `.claude/launch.json` got
`autoPort: true` (port 3000 was held by the talent-agency dev server).

---

**Session span:** 2026-07-02 → 2026-07-09
**Driver:** Mitch Baney (owner; directs, doesn't write code)
**What this session did:** Ran a **full project review** (5-agent workflow +
verified claims) that produced an approved **improvement roadmap** (plan file:
`~/.claude/plans/claude-i-want-you-fluffy-sparrow.md`), then shipped its first
two stages: **(a) the Stripe money-path fixes** and **(b) the quick-win batch**
(lifecycle receipt emails, booking-form access notes, admin refund buttons,
seasonal-nudge batch send, rate-limit split, real mailing address, Sheets
sunset declared), then **(c) the daily lifecycle cron** (appointment
reminders, quote-expiry nudges, stalled-deal digest, Stripe reconciliation
backstop — `/api/cron/lifecycle`, 13:00 UTC daily), and **the stage-(c)
remainder** (admin "How's business" metrics strip, `/service-area` page,
money-path webhook-replay test suite). All merged to `main` + deployed. Every
stage passed a 2-reviewer adversarial review; all confirmed findings fixed
pre-merge.

**Owner decision (2026-07-09):** the planned 8 per-town SEO landers were built,
reviewed, previewed — and REJECTED by Mitch as off-brand fluff ("too generic or
AI-generated"; homepage stays the front door). Consolidated into ONE plain
`/service-area` page (factual town cards + anchors; footer links there). See
memory `feedback_brand_voice.md` — this is a standing copy bar, not a one-off.

`main` HEAD = the `feat/lifecycle-cron` merge. Production auto-deploys from a
`main` push (Vercel).
Read the memory files first (see Pointers) — `project_improvement_roadmap.md`
holds the roadmap state.

---

## TL;DR — current state (2026-07-02)

| Thing | State |
|---|---|
| **Stripe money path** | **FIXED + LIVE** (`b1eb220`) — two-phase webhook idempotency (a thrown handler releases its claim so Stripe's retry re-processes; 96h done-TTL > Stripe's 3-day retry window; `maxDuration=60` pinned); dashboard refunds resolve jobId via the parent PaymentIntent; refund ledger is cumulative-correct (one row per charge) |
| **Lifecycle emails** | **LIVE** — deposit-received receipt (from `checkout.session.completed`, best-effort), completion receipt + folded review ask (from `markComplete` both paths AND the balance-charge webhook for 3DS-deferred completions). `review_sent_at` stamps only on successful send → the review cron stays a backstop, no double-ask |
| **Access notes** | **LIVE** — "Getting in (optional)" field on the booking wizard details step; rides the job description as a `🔑 Access:` line (no schema change) → Telegram card + admin job page show it |
| **Refunds** | **LIVE** — Refund buttons on `/admin/jobs/[id]` for succeeded deposit/balance payments (full refund, confirm step; webhook owns the status flip). `refundCharge` accepts charge OR payment-intent id |
| **Seasonal nudges** | **Batch send LIVE** — "Send all N with default templates" + Redis mutex (no double-send from concurrent submissions); per-recipient failure tally |
| **Admin rate limits** | **Split** — cheap mutations 30/min (`admin-action`), money actions 5/min (`admin-money`: quote send, markComplete, refund) |
| **Mailing address** | **REAL** — 2012 Raccoon Run, Clayton, NC 27527 (was PO Box 0000; CAN-SPAM closed) |
| **Sheets backend** | **Sunset declared** — no new sheet-mode features; target removal 2026-08-15 (docs/stage-13-postgres-design.md) |
| **Lifecycle cron** | **LIVE** — daily 9 AM ET: day-before reminders (ET-day bucketing = exactly-once), once-per-quote expiry nudges (reads `paymentLinkUrl`/`expiresAt` stamped in the `quote.sent` activity payload; legacy quotes get no-button fallback; `quote.nudge_sent` activity = durable guard), owner digest (only when non-empty), Stripe drift backstop (report-only → Sentry + digest; deposit-on-Cancelled flagged on purpose) |
| **Admin metrics strip** | **LIVE** — "How's business" band on /admin: cash collected this ET month (cash-basis, deliberate), quote→paid conversion 90d (quote.sent activities), median lead→done, top source. Postgres-only, best-effort (failure hides the band, never the dashboard) |
| **/service-area page** | **LIVE** — one on-brand page, 8 factual town cards w/ anchors; footer "Areas We Serve" links there; layout areaServed fixed 3→8 towns; sitemap entry |
| **Money-path replay suite** | tests/stripe-money-path-replay.test.ts — real route + real handlers, in-memory Redis/job store: deposit→Booked+receipt, throw-then-retry recovery, dedup, dashboard-refund PI fallback, balance→Complete w/ exactly-one receipt |
| Code health | typecheck clean · **246 tests pass** · lint clean (2 pre-existing cosmetic warnings) |
| Supabase | still one project = prod **and** local `.env.local` (Pending #4) |

**Roadmap corrections vs old pending list (verified in code):** the Saturday
hours "mismatch" is NOT in the repo — David's open windows live in his Google
Calendar (fix = calendar edit or copy change); review emails already had an
unsubscribe link.

---

## What shipped this session (all merged to main + deployed)

1. **Stripe money-path fixes** (`d3527fa`, merged `b1eb220`) —
   lib/webhooks/idempotency.ts two-phase claim (`beginProcessing`/`markDone`/
   `releaseProcessing`; legacy `'1'` values dedupe as done for safe rollout;
   Telegram deliberately stays single-phase — its route swallows errors);
   app/api/webhooks/stripe/route.ts releases the claim on handler throw;
   handleChargeRefunded falls back to the parent PI's metadata (dashboard
   refunds/chargebacks now land) and surfaces unresolvable refunds to Sentry;
   `recordRefund` keeps ONE ledger row per refunded charge (cumulative
   amounts). +24 tests incl. route-level claim-flow tests.
2. **Quick-win batch** (`19c61da` + `71a99ef`, merged `fe14ce3`) — see TL;DR
   rows. New files: lib/email/deposit-receipt.ts, lib/email/completion-receipt.ts,
   app/admin/jobs/[id]/RefundSection.tsx, app/admin/seasonal-nudges/SendAllButton.tsx,
   `listRefundablePayments` in lib/data/pg/payments.ts.

## Review findings fixed pre-merge (adversarial reviewers)

- Ledger lost the PI id when `charge.payment_intent` arrives expanded (fixed +
  regression test).
- `DONE_TTL` sat exactly at Stripe's 72h retry window → bumped to 96h;
  `maxDuration=60` pinned on the webhook route (must stay ≪ the 10-min claim TTL).
- 3DS-deferred completions never got the completion receipt → the
  balance-charge webhook now sends it when `review_sent_at` is unstamped.
- Concurrent "Send all" nudge batches could double-email → Redis mutex.

---

## Pending — needs Mitch (carried forward)

1. **★ $1 live Stripe smoke test** (docs/go-live-runbook.md §2) — quote → pay
   deposit → Booked + card saved → Mark Complete → balance charges → refund
   both. All known blockers are now fixed; this certifies the money path.
2. **★ Sentry alert rules** (Sentry dashboard) — payment errors, webhook
   failures, admin auth-failure spike. Until then failures are logged, not alerted.
3. **Maps API key restriction** (Google Cloud Console) — see
   `reference_maps_api_config.md`.
4. **Separate dev Supabase project** + drop `truncate_for_migration()` from
   prod (supabase/migrations/20260613173800_init_schema.sql:233) + Supabase Pro.
5. **Saturday hours** — edit David's Google Calendar availability window to
   match the advertised 9–2 (or change site copy). Not a code change.
6. **Twilio SMS** — unchanged: finish toll-free verification, then deploy
   `feat/sms-consent` and build the SMS legs.

## Next code stage (roadmap (d) — big bets, approved)

David's field view (front of the CRM rebuild queue — mobile page: today's
jobs, photos, access notes, arrived/done taps; retires Telegram dispatch),
then SMS legs on the lifecycle cron when Twilio toll-free verification lands.
Non-code on Mitch: set `GOOGLE_REVIEW_URL` (real GBP review link) in Vercel.

---

## Branch / commit map

| Branch | HEAD | Meaning |
|---|---|---|
| `main` | metrics-seo-replay merge | **production** — everything above merged + live |
| `feat/sms-consent` | `3d99fc3` | SMS-consent line — **HELD, not deployed** (verified excluded at all four merges) |
| (merged this session) | | `fix/stripe-money-path`, `feat/quick-wins`, `feat/lifecycle-cron`, `feat/metrics-seo-replay` |

---

## Gotchas the next session must know

- **Prod pushes are gated** — pushing to `main` / migrating the prod DB needs an
  explicit, per-action "yes" from Mitch. "build it" is not enough.
- **`feat/sms-consent` must stay out of deploys** — verify at every merge.
- **Local `.env.local` = the production Supabase project** — local work hits
  live data (Pending #4).
- **Completion receipt ↔ review cron contract:** `review_sent_at` is the
  dedupe. Stamp it ONLY after a successful receipt send; the cron skips
  stamped jobs. Break that and customers get double review asks (or none).
- **`admin-money` vs `admin-action` buckets** — any NEW action that moves money
  must use `rateLimitAdminMoney` / `checkLimit("admin-money", …)`.
- **Webhook route `maxDuration` (60s) must stay well under the idempotency
  layer's 10-min processing TTL** — see comment in app/api/webhooks/stripe/route.ts.
- **`"use server"` files can't export types** except the established
  `export type` pattern (see NudgeActionResult) — copy existing usage.
- **Don't use multi-agent workflows for simple checks** (Mitch's feedback) —
  ask or run a quick probe instead.

## Pointers

- **Memory (auto-loaded):** `~/.claude/projects/-Users-mbaney-forge-handyman/memory/`
  — `MEMORY.md` index; **`project_improvement_roadmap.md` (NEW — roadmap state,
  read this first)**, `project_editable_crm.md`, `project_crm_build.md`,
  `project_forge_family.md`, feedback + reference files.
- **Roadmap plan file:** `~/.claude/plans/claude-i-want-you-fluffy-sparrow.md`.
- **Docs:** `docs/stage-13-postgres-design.md` (incl. NEW Sheets-sunset
  section), `docs/go-live-runbook.md`.
- **How we work:** design → adversarial critique → build → independently-verified
  review → live verification → commit. Keep doing it.
