# Forge Handyman — Session Log

**Session span:** 2026-06-26 → 2026-06-28
**Driver:** Mitch Baney (owner; directs, doesn't write code)
**What this session did:** Took Forge from "built but unverified" to **live and
ready to invite friends-and-family**. Ran a full go-live audit, removed the
July 4 holiday from availability, put the **real phone number** live, made
**Forge Family 30% off carry all the way through booking**, made **self-scheduled
jobs quotable** (with the amount pre-filled from the cart), went **LIVE on
Stripe**, and fixed a quote-email encoding bug. Surfaced (not yet fixed) several
real **Stripe money-path bugs** to address before taking real card volume.

`main` HEAD = `7cd6f08`. Production auto-deploys from a `main` push (Vercel).
Read the memory files first (see Pointers) — they hold the cross-session state.

---

## TL;DR — current state (2026-06-28)

| Thing | State |
|---|---|
| Marketing site + booking form | **Live** (forgehandyman.com) |
| **Self-scheduling** | **LIVE & WORKING** — David is a configured technician; real Saturday slots. **July 4 removed** (holiday) → earliest bookable = **Sat Jul 11**. Window is Sat ~9am–5pm ET |
| **Real phone number** | **Live everywhere** — `(919) 275-2823`, single-sourced from `BUSINESS.phone`/`phoneHref` in lib/constants.ts (fake `(555)` fully gone) |
| **Forge Family 30% off at booking** | **LIVE** — `/family` "Book a Job" → `/contact?family=1`; cart shows family prices + banner + family-rate total; lead tagged "FORGE FAMILY"; confirmation email notes the rate |
| **Quoting self-scheduled jobs** | **Live** — "Send Quote" now shows on **Booked** jobs; quote amount **pre-fills from the cart** they picked (family-aware) |
| **Stripe** | **LIVE MODE** — Mitch added live keys + (per Mitch) the live webhook. Quote→deposit→balance path is live but **NOT yet $1-tested** and has **known money-path bugs** (see Pending #1) |
| Code health | typecheck clean · **165 tests pass** · lint clean (2 cosmetic warnings) |
| **Twilio SMS** | **DEFERRED** — going Google Voice for the callable number. Twilio toll-free number bought, verification **PAUSED**. SMS-consent form line built but **HELD on branch `feat/sms-consent`** (NOT deployed) |
| Mailing address | still `PO Box 0000` placeholder — Mitch getting a real PO box |
| Supabase | one project = prod **and** local `.env.local`; Pro upgrade still recommended |

---

## What shipped this session (all merged to main + deployed, verified live)

1. **Real phone number** (`76c850a`) — replaced `(555) 123-4567` site-wide incl.
   the confirmation/cancel emails, error strings, SEO/JSON-LD; routed every
   hardcoded copy through the `BUSINESS` constant. Verified live.
2. **Forge Family 30% off through the booking flow** (`a6c0e9f`) — `family` flag
   carried from the `/family` link, read server-side (no flash), cart renders
   family prices (struck base + orange) + "30% off applied" banner + family-rate
   total; server tags the lead "FORGE FAMILY" + itemizes at family prices;
   confirmation email notes the rate. All math derives from `familyCents()` in
   lib/family-pricing.ts (same rounding as the /family page). +tests.
3. **Quote self-scheduled jobs + pre-fill** (`e624f7a`) — "Send Quote" shows on
   `Booked` jobs; `estimateCentsFromDescription()` reads the price back out of the
   stored cart summary to pre-fill the quote (structured cart still not persisted
   — Phase D). +tests.
4. **Stripe → LIVE** — Mitch added `STRIPE_SECRET_KEY_LIVE` (+ publishable + per
   Mitch the live webhook secret) to Vercel; the redeploy flipped the app to live
   mode (`getStripeMode()` returns 'live' once the live secret key is present).
5. **Quote email subject mojibake fix** (`7cd6f08`) — the subject dropped a raw
   em-dash into the header with no encoding (`Ã¢Â€Â"` garble); now RFC-2047
   encoded-word, mirroring lib/google.ts. (Body was always fine.)

Also: a full **go-live audit** (multi-agent) confirmed the booking path is sound
and surfaced the real blockers that got fixed above; and a **Stripe money-path
verification** surfaced the bugs in Pending #1.

---

## Decisions made this session

- **Phone:** Google Voice for the callable business number = `(919) 275-2823`
  (now live on the site). Twilio is only for *automated SMS* later — **not needed
  to launch** (bookings confirm via email + Telegram).
- **Twilio SMS DEFERRED:** not required for the friends launch. Toll-free number
  bought + mid-verification, then **paused**. The SMS booking-confirmation feature
  is **not built**. An SMS-consent disclosure for the booking form is committed but
  **HELD on `feat/sms-consent`** — deploy it only when SMS actually goes live (no
  point telling customers they'll get texts before we send any).
- **Family pricing:** auto-apply end-to-end (chosen over "manual discount at
  invoice" and over "auto-send a quote on booking").
- **Quoting self-scheduled customers:** required — "any time someone self
  schedules they need a quote afterward." Shipped the button + pre-fill; chose
  pre-fill-from-cart over fully-automatic-quote-on-booking.
- **Feedback captured:** don't spin up multi-agent workflows for simple
  verifications / config confirmations — ask or probe directly (see
  `feedback_workflow_restraint.md`).

---

## Pending — needs Mitch / next session (action items)

1. **★ Stripe money-path bugs — fix before real card volume (offered, NOT built).**
   All silent, all code, none affect the friends *scheduling* launch (no payment
   there). Double-charge protection IS solid (verified). The real ones:
   - **Refunds don't update the job** — `charge.refunded` keys off
     `charge.metadata.jobId`, which Stripe never sets on the Charge (it's on the
     PaymentIntent). Every dashboard refund silently no-ops the status/ledger.
     (lib/stripe/webhook-handlers.ts:259)
   - **Webhook dedup not rolled back on failure** — the idempotency key is marked
     processed *before* the handler runs; if a handler throws (500), Stripe's retry
     is deduped and dropped → a deposit can be paid but the job never flips to
     Booked, silently. (lib/webhooks/idempotency.ts + the webhook route)
   - **Unguarded `paymentIntents.retrieve`** in the deposit webhook can trigger
     exactly that on a transient Stripe blip. (webhook-handlers.ts:57)
   - **No reconciliation backstop** if a crash lands between a successful balance
     charge and the DB write (recoverable only via the webhook).
2. **$1 live Stripe smoke test** — send a quote ($1+$1) to himself → pay deposit
   with a real card → confirm job → **Booked** + card saved → **Mark Complete** →
   balance charges → refund both → confirm **Refunded**. This validates the live
   webhook + happy path. (Note: the refund-status bug above means the "Refunded"
   step won't flip the job until that fix lands.)
3. **Real mailing address** — swap `PO Box 0000` in lib/constants.ts when the PO
   box is set up (CAN-SPAM; legal pages + automated-email footers).
4. **Twilio SMS (when ready)** — finish the toll-free verification, deploy
   `feat/sms-consent`, then build the SMS feature (`lib/twilio/` doesn't exist).
5. **Supabase Pro** — avoid free-tier auto-pause now that the DB is business-critical.
6. **Hours mismatch** — site advertises Saturday **9–2** but David's availability
   calendar is **9–5**. Reconcile (calendar or the BUSINESS.hours copy).
7. **Separate dev Supabase project** — local `.env.local` still points at the
   *production* DB.

---

## Branch / commit map

| Branch | HEAD | Meaning |
|---|---|---|
| `main` | `7cd6f08` | **production** — everything in "What shipped" is merged + live |
| `feat/sms-consent` | `3d99fc3` | SMS-consent line for the booking form — **HELD, not deployed** (deploy when Twilio SMS goes live). Touches ContactForm.tsx; trivial merge (separate region) |
| (merged into main) | | `fix/real-phone-number`, `feat/family-pricing-at-booking`, `fix/quote-booked-jobs`, `fix/email-subject-encoding` |

---

## Gotchas the next session must know

- **Prod is LIVE on Stripe.** Real cards will be charged through the quote flow.
  Treat the money path carefully; fix Pending #1 before real volume.
- **`STRIPE_SECRET_KEY_LIVE` flips the whole app to live mode** the instant it's
  set; the webhook then *requires* `STRIPE_WEBHOOK_SECRET_LIVE` (throws without it).
  Health check does NOT verify the webhook secret — the $1 test is the real proof.
- **Prod pushes are gated** — the auto-mode classifier blocks pushing to `main` /
  migrating the prod DB without an explicit, per-action "yes deploy this" from
  Mitch. "build it" is not enough.
- **`feat/sms-consent` must stay out of deploys** until SMS goes live — every
  merge-to-main this session explicitly verified it wasn't included.
- **Self-scheduling:** events on the tech's "Forge Availability" calendar = open
  windows (must be **timed**, not all-day); primary-calendar events block. July 4
  was removed by deleting that day's occurrence.
- **DATA_BACKEND=postgres is LIVE.** Local `.env.local` = the **production**
  Supabase project — local work hits live data.
- **Vercel Sensitive env vars are write-only**; **Hobby cron is daily-only**.
- **Don't use multi-agent workflows for simple checks** (Mitch's feedback) — ask
  or run a quick probe instead.

---

## Pointers

- **Memory (auto-loaded):** `~/.claude/projects/-Users-mbaney-forge-handyman/memory/`
  — `MEMORY.md` index, `project_crm_build.md` (live build state, updated this
  session), `project_forge_family.md` (family pricing + the auto-apply decision),
  `feedback_workflow_restraint.md`, `feedback_no_checkpoint_questions.md`,
  `reference_maps_api_config.md`, `user_mitch.md`.
- **Docs:** `docs/go-live-runbook.md` (Stripe go-live), `docs/stage-13-postgres-design.md`,
  `docs/stage-14-crm-interface-design.md`.
- **How we work:** design → adversarial critique → build → independently-verified
  review → live verification → commit. Keep doing it.
