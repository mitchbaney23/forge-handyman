# Forge Handyman — Session Log

**Session span:** 2026-06-12 → 2026-06-17
**Driver:** Mitch Baney (owner; directs, doesn't write code)
**What this multi-day session did:** Took Forge from a marketing site + Google-
Sheet CRM to an agent-native **Postgres CRM (LIVE)**, launched a flat-rate
**service menu (LIVE)** + time-aware **booking cart (LIVE)**, built and shipped
**customer self-scheduling (Phase C, LIVE but dormant)** with **self-service team
onboarding**, and fixed the site's **geocoding/Maps** integration. Stripe is
still TEST mode.

This file is the handoff for the next session. The terse cross-session state also
lives in the memory files (see "Pointers") — read those first.

`main` HEAD = `056f06b`. Production auto-deploys from a `main` push (Vercel).

---

## TL;DR — current state (2026-06-17)

| Thing | State |
|---|---|
| Marketing site + booking form | **Live** (forgehandyman.com) |
| Flat-rate **service menu** | **Live** |
| **Booking cart** ("Build your job") | **Live** |
| Postgres CRM (Phases A + B) | **Live on Postgres** (`DATA_BACKEND=postgres`) |
| Data cutover to Postgres | **Done — fresh start** (Sheet leads NOT migrated; empty pg) |
| **Self-scheduling (Phase C)** | **Live but DORMANT** — picker falls back to callback until David's availability calendar exists |
| **Team onboarding** (`/admin/technicians`) | **Live** — add a tech → auto-provisions their availability calendar |
| Address autocomplete + "use my location" | **Fixed & working** (was a Google Cloud key/API config issue) |
| Contact-step trim (drop best-time/method) | **Live** (deployed with cancellation) |
| **Booking cancellation** (admin + customer self-serve) | **Live** — admin button on job page; customer cancel link in a confirmation email → `/booking/cancel` |
| Availability freshness | **Real-time** (`no-store`, no cache) |
| Stripe | **TEST mode** (no live keys) — card capture **deferred** (see decisions) |
| Phone number on site | still `(555) 123-4567` placeholder |
| Supabase | one project (`nkvsgvlyxwdsvklxypwu`) = prod **and** local `.env.local` |

---

## 2026-06-17 — what shipped today

### Cutover → Postgres is LIVE (fresh start)
Flipped prod from Sheet to Supabase Postgres. Added `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` (sensitive), `DATA_BACKEND=postgres` to Vercel
Production; deployed (`8542038`). `/api/health` → `backend: postgres`, no
downtime. Chose **fresh start** (no Sheet migration → sidestepped the Google-key
blocker). Old Sheet leads remain in the Sheet, un-imported.

### Booking cart + form refinements → LIVE
Merged the cart (`ecc4a7b`). Earlier: made the booking **description optional**
on the menu path (required only on "not sure / custom"), reframed the **photo**
copy for flat-rate.

### Self-scheduling (Phase C) → LIVE, dormant (`f678d7a`)
Customers pick a real open slot and are **auto-confirmed** (calendar event +
appointment + job→Booked + firm Telegram card to David, no approve/decline).
- **Calendar-driven, per-technician** (the multi-employee model): the service
  account impersonates each `@forgehandyman.com` tech via domain-wide delegation
  to read availability + free/busy and write bookings. NO hardcoded hours.
- **Availability model:** events on a tech's **"Forge Availability" calendar** =
  open windows; their **primary-calendar** events = conflicts (free/busy);
  existing Forge appointments also block. Slots are sized to the **cart's job
  duration** + a flat 30-min travel buffer.
- Built: `lib/scheduling/{config,slots(pure+7 tests),time,availability}`,
  `app/api/scheduling/availability` (rate-limited), migration
  `20260617120000_appointments.sql` (appointments table + partial-unique index +
  `claim_slot` RPC mirroring the payments double-charge guard + technician
  calendar columns), `lib/data/pg/appointments.ts`, `lib/google` `getAuth(subject)`
  + `createBookingEvent`/`deleteBookingEvent`, the contact-route booking flow
  (claim → freebusy re-check → event → Booked → dispatch, compensating on
  failure), the "Pick your time" form step + fallbacks, firm Telegram cards, a
  `google-calendar` health check.
- Migration **applied to prod** by Mitch (`supabase db push`). Verified green.

### Team onboarding `/admin/technicians` → LIVE (`f171640`)
Add-technician form (name, `@forgehandyman.com` email, optional Telegram id) →
server **auto-creates their "Forge Availability" calendar** (Calendar API, DWD)
and stores its id — no Calendar-ID hunting, no SQL. Per-row "Provision calendar"
retry + activate/deactivate. New "Team" nav link.

### Geocoding / Maps fix (`056f06b` + Mitch's Google Cloud changes)
Address autocomplete + "use my location" were dead. Root causes: **Places API
(New) disabled** in the project, the **key's API-restrictions** list didn't
include Places (New) / Geocoding, and CSP didn't allow `places.googleapis.com`.
Mitch enabled the APIs + fixed the key restrictions; I added `places.googleapis.com`
to the CSP `connect-src`. **Confirmed working** (live probe returns real
suggestions). See memory `reference_maps_api_config.md`.

### Contact-step trim → committed, NOT deployed
Removed "best time to reach you" + "preferred contact method" from the final form
step (redundant now customers pick a real slot); kept "how did you hear about
us." Server schema keeps those fields optional (default `'any'`) for back-compat;
lead dispatch hides the pref line when default. On `feat/booking-card-capture`
(`0e9047b`) — **ready to merge/deploy**.

### Booking cancellation + real-time availability → LIVE (`172d79a`)
- **Real-time:** availability endpoint is `no-store` — cancellations/new bookings
  show in the picker immediately.
- **Admin:** "Cancel booking" on `/admin/jobs/[id]` → `performCancellation`
  (cancel row + delete calendar event + job→Cancelled + log + notify David).
- **Customer self-serve:** every booking sends the customer a confirmation email
  (`sendBookingConfirmationToCustomer`) with the firm time + a signed cancel link
  (`lib/scheduling/cancel-token.ts`, reuses `UNSUBSCRIBE_HMAC_SECRET`) → public
  `/booking/cancel` page. The email also carries the "please give 24h notice"
  policy (no fee, per the decision below).
- **Gotcha:** deleting a calendar event does NOT cancel a booking — the
  `appointments` row is the source of truth. Cancel via the button / customer link.
- **Follow-up:** notify the *customer* by email when *David* cancels (today only
  David is pinged).

### Decisions made today
- **Travel time:** keep the **flat 30-min buffer** for now. Distance-aware
  drive-time (Google Distance Matrix) deferred until David's Saturdays pack with
  multiple jobs — design is captured but not built.
- **Card capture: DEFERRED.** Mitch chose **no no-show fee yet** ("please give
  24h notice"), so a card-on-file would be friction with no teeth → skip it.
  Build card-on-file **and** the fee together when busier. (Recommended a plain
  "please give 24 hours notice to cancel/reschedule" text line on the booking —
  **not yet built**, awaiting Mitch's go.)
- **Supabase Pro recommended** — the free tier auto-pauses after ~7 days idle;
  the daily review-requests cron currently keeps it awake as a side effect, but
  Pro is the only guaranteed no-pause fix now that this DB is business-critical.

---

## Pending — needs Mitch (action items)

1. **★ Make booking go live: add David in `/admin → Team`** (name,
   `david@forgehandyman.com`) → it auto-creates his "Forge Availability"
   calendar → drop a **recurring Saturday 9–2 "Open for jobs"** event on it →
   the slot picker goes live. Then run one **test booking** end-to-end (pings
   David's Telegram — coordinate). This is the single step left for bookings.
2. **Deploy the contact-step trim** — merge `feat/booking-card-capture`
   (`0e9047b`) → `main` (awaiting "deploy it"). Optionally add the 24h-notice
   text first.
3. **Supabase Pro** upgrade (avoid free-tier auto-pause).
4. **Stripe go-live** — `docs/go-live-runbook.md` (business verification + live
   restricted key + live webhook; code auto-selects live keys when present).
   Run the 5-scenario **sandbox dress rehearsal** on test-mode prod first.
   THEN build **card-on-file + no-show fee** when busier.
5. **Twilio phone number** → replaces `(555) 123-4567` in `BUSINESS.phone`.
6. **Real mailing address** — `BUSINESS.mailingAddress` still `PO Box 0000`
   (CAN-SPAM).
7. **Separate dev Supabase project** — local `.env.local` currently points at
   the *production* DB.

---

## Branch / commit map

| Branch | HEAD | Meaning |
|---|---|---|
| `main` | `056f06b` | **production** — cutover + cart + self-scheduling + onboarding + geocoding fix, all live |
| `feat/booking-card-capture` | `0e9047b` | contact-step trim — committed, NOT merged/deployed |
| (older, merged) | | `feat/self-scheduling` `cb3e961`, `feat/technician-onboarding` `b318a59`, `feat/booking-cart`, `feat/services-menu` |

---

## Gotchas the next session must know

- **Prod pushes + `supabase db push` are gated by the auto-mode classifier** —
  it blocks pushing to `main` / migrating the prod DB without an **explicit,
  per-action "yes deploy/push this"** from Mitch. "do it all" / "build it" is NOT
  enough. Ask for the specific go each time (or Mitch adds a Bash permission rule).
- **Maps API key** (`…TAAM`, project `103758953430`): needs Places API (New) +
  Geocoding API + Maps JS enabled in the project **AND** listed in the **key's
  API-restrictions**; CSP must allow `maps.googleapis.com` + `places.googleapis.com`.
  Referrer-restricted keys can't be probed via the Geocoding REST API. See
  `reference_maps_api_config.md`.
- **`DATA_BACKEND=postgres` is LIVE** now (no longer sheet). Local `.env.local`
  = the **production** Supabase project — local work hits live data.
- **Self-scheduling availability:** events on the "Forge Availability" calendar =
  openings; primary-calendar events = conflicts. Empty calendar = zero bookable
  time (opt-in), not infinite. Booking picker stays in callback-fallback until a
  technician with an availability calendar exists.
- **Vercel Sensitive env vars are write-only** (`vercel env pull` → `""`).
- **Vercel Hobby cron is daily-only**; a sub-daily cron silently fails the deploy.
- Both CLIs authed locally: `supabase` (org `hedvxndzzieuvomqvqed`) + `vercel`
  (`mitchbaney23`).

---

## The plan from here

- **Phase C — DONE** (self-scheduling shipped). Remaining polish: David's full
  Telegram **daily agenda** view; customer self-serve reschedule/cancel links;
  distance-aware **travel time**; multi-tech assignment UI.
- **Card-on-file + no-show fee** — deferred until busier (design ready).
- **Phase D** — price book → quotes (`catalog_items`); persist the structured
  cart (`cart_json`) so quotes build from the customer's selections.
- **Phase E** — MCP server + approval queue + scheduled routines (Claude co-runs
  leads/follow-ups). The activities table + `claude` actor are already laid.
- **Phase F** — invoicing + per-job costing + reporting (margin by job type,
  lead-source ROI — the kept "how did you hear about us" feeds this).

---

## Pointers

- **Memory (auto-loaded):** `~/.claude/projects/-Users-mbaney-forge-handyman/memory/`
  — `MEMORY.md` index, `project_crm_build.md` (live build state),
  `reference_maps_api_config.md` (Maps key setup), `user_mitch.md`, feedback.
- **Plan file:** `~/.claude/plans/hey-claude-i-actually-inherited-gosling.md`
  (the self-scheduling design).
- **Docs:** `docs/go-live-runbook.md`, `docs/stage-13-postgres-design.md`,
  `docs/stage-14-crm-interface-design.md`.
- **How we work:** design → adversarial critique → build → independently-verified
  review → live verification → commit. It has caught a real bug in every phase.
  Keep doing it.
