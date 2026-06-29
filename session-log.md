# Forge Handyman — Session Log

**Session span:** 2026-06-28 → 2026-06-29
**Driver:** Mitch Baney (owner; directs, doesn't write code)
**What this session did:** Made the **admin CRM editable** (add customers by
hand + drag/move deals), ran a **granular services-menu audit** (only list what
David can deliver), then cleared a **full bug batch from Braden's testing** —
quote-builder crash, Turnstile no-show, address re-submit, the availability
"no times" bug — **expanded the coverage area to the wider metro (20 mi, 8
towns)**, added **customer confirmation emails for every lead**, **hardened photo
uploads**, and fixed the **wonky hammer animation**. Everything below is merged
to `main` + live. One open item from the batch: the **Maps API key restriction**
(Mitch's Google Cloud Console task).

`main` HEAD = `44c32ab`. Production auto-deploys from a `main` push (Vercel).
Read the memory files first (see Pointers) — they hold the cross-session state.

---

## TL;DR — current state (2026-06-29)

| Thing | State |
|---|---|
| Marketing site + booking form | **Live** (forgehandyman.com) |
| **Editable CRM** | **LIVE** — add customers by hand (+ optional first deal) on `/admin/customers`; **drag deals** between pipeline stages (or a per-card "Move to…" menu for mobile). All writes go through a shared `lib/crm/mutations.ts` core that the UI uses today and an MCP server can reuse later |
| **Service menu** | **Audited + live** — vague items removed, concrete ones added, parts policy stated once. 8 categories; see "What shipped" |
| **Coverage area** | **20-mi radius from Garner (was 15)** — covers Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs & Fuquay-Varina; public copy + SEO now advertise all 8. Tunable via `SERVICE_AREA_RADIUS_MILES` |
| **Booking form** | **Hardened** — Turnstile now renders on the visible step; address re-submit after "out of area" works; availability retries (3×) + a "Try again" button; **every in-area lead gets an HTML confirmation email** |
| **Self-scheduling** | **LIVE** — David configured; real Saturday slots; earliest = Sat Jul 11. (Hours mismatch still open — Pending #6) |
| **Stripe** | **LIVE MODE** — quote re-send no longer crashes on a changed amount (idempotency fix). Still **NOT $1-tested**; **known money-path bugs** remain (Pending #1) |
| Code health | typecheck clean · **191 tests pass** · lint clean (2 cosmetic warnings) |
| **Photo uploads** | **Hardened** — server-side magic-byte check (spoofed non-images rejected); land on Google Drive, not our domain |
| **Maps API key** | ⚠️ **Action on Mitch** — restrict the key in Google Cloud Console (Pending #8) |
| **Twilio SMS** | **DEFERRED** — `feat/sms-consent` HELD, not deployed |
| Mailing address | still `PO Box 0000` placeholder |
| Supabase | one project = prod **and** local `.env.local` |

---

## What shipped this session (all merged to main + deployed)

1. **Editable CRM** (`65bd70a`) — shared, framework-free mutation core
   `lib/crm/mutations.ts` (`moveJobStatus`, `createCustomer`) called by the UI
   today and MCP-ready for later. **Add customer** by hand (+ optional first
   deal) on `/admin/customers`; **pipeline drag-and-drop + tap-to-move menu**
   reusing the existing status state machine (Complete stays un-draggable —
   needs the balance charge). New data primitives `findCustomerByEmail` +
   `insertCustomer` (there was no standalone customer insert before). +12 tests.
2. **Services menu audit** (`6876f91`) — removed vague/undeliverable items
   ("Squeaky stairs / loose handrail", "Weatherstripping or door sweep"); added
   Door knob replacement, Cabinet door/drawer repair, Window/door screen repair,
   Smoke & CO detector swap, Grab bar install, **Showerhead swap**, **Soundbar
   mount**; reworded "Drywall patch — small hole (patch only)" and "Paint — trim
   & doors"; closed the TV size gap (≤60" / >60"). **Parts policy** now stated
   once in a "Parts & fixtures" callout (dropped the per-item "you supply X").
3. **Quote re-send fix** (`b9d47f8`) — Stripe "Keys for idempotent requests can
   only be used with the same parameters" crash when re-quoting a job at a
   different amount. Fixed by folding a content hash into the product/price/link
   idempotency keys (lib/stripe/payment-links.ts). +tests.
4. **Booking-form Turnstile + address fixes** (`a312cf2`) — Turnstile rendered
   into a `display:none` panel (0×0, interactive challenge never appeared → "complete
   the verification challenge" with nothing there); now renders when the contact
   step is visible. And the out-of-area path didn't reset the single-use Turnstile
   token, so a corrected re-submit 403'd; now resets it.
5. **Customer confirmation email for every lead** (`eef878a`) — the non-booking
   lead path (callback/flexible/custom/"not sure") notified the business but
   never the customer. Added `sendLeadAcknowledgmentToCustomer` (HTML + text).
   Booked customers already got "You're booked"; out-of-area intentionally stays
   silent.
6. **Coverage radius 15 → 20 mi** (`f56793c`) — covers the wider metro;
   contact-page "15-mile" copy updated. Then **metro-copy sweep** (`d74d377`) +
   **add Holly Springs & Fuquay-Varina** (`de8ed58`) — public service-area copy +
   SEO (title/description/keywords/OG/Twitter, footers, contact form) now list all
   8 towns. Header bar uses "Garner, Raleigh, Cary & nearby" (8 won't fit). Both
   new towns were already inside 20 mi — no radius change for them.
7. **Availability retry + upload hardening** (`09fb6c4`) — timing step now
   retries the slot fetch 3× w/ backoff and shows a "Try again" button (fixes
   "couldn't see times until the 3rd/4th pass" — a cold-start/transient Google
   blip used to dump to the callback fallback with no recovery). And photo upload
   now validates **magic bytes** server-side (`lib/security/image-sniff.ts`),
   rejecting spoofed non-images. +tests (incl. a test proving the contact API
   rejects a garbage email + blank name server-side).
8. **Hammer animation** (`44c32ab`) — replaced the sideways/ambiguous Phosphor
   claw hammer with a clean head+handle silhouette posed over the nail; retuned
   the strike to cock back and drive onto the nail head.

---

## Decisions made this session

- **CRM MCP server — DEFERRED.** Build it later as a **remote** endpoint
  (`app/api/mcp/route.ts` on Vercel, behind auth) so **Claude Cowork** can operate
  the CRM from anywhere — a local stdio server can't reach cloud Cowork. The
  shared `lib/crm/mutations.ts` core is built MCP-ready, so it's transport-only
  later (logs `actor: claude`). See `project_editable_crm.md`.
- **Service-area copy = list the towns** (chosen over a regional "greater Raleigh
  area" phrase) — each town name is a local-SEO keyword.
- **Out-of-area customers get no email** (Mitch) — they're shown the on-screen
  "call David" message; we don't acknowledge leads we won't serve.
- **Deliverability bar for the menu:** only list what David will confidently do.
  Held off **smart thermostat** and **video doorbell** (C-wire / transformer
  gotchas he hasn't done).

---

## Pending — needs Mitch / next session (action items)

1. **★ Stripe money-path bugs — fix before real card volume (still NOT built).**
   Refund webhook keys off `charge.metadata.jobId` (Stripe sets it on the
   PaymentIntent, not the Charge) → dashboard refunds silently no-op; webhook
   dedup is marked processed *before* the handler runs (a thrown handler drops
   Stripe's retry → deposit paid but job never flips to Booked); unguarded
   `paymentIntents.retrieve` in the deposit webhook; no reconciliation backstop.
   (lib/stripe/webhook-handlers.ts, lib/webhooks/idempotency.ts)
2. **$1 live Stripe smoke test** — quote → pay deposit → Booked + card saved →
   Mark Complete → balance charges → refund both. (The refund-status bug above
   means the "Refunded" step won't flip the job until #1 lands.)
3. **Real mailing address** — swap `PO Box 0000` in lib/constants.ts (CAN-SPAM).
4. **Twilio SMS (when ready)** — finish toll-free verification, deploy
   `feat/sms-consent`, then build the feature (`lib/twilio/` doesn't exist).
5. **Supabase Pro** — avoid free-tier auto-pause now the DB is business-critical.
6. **Hours mismatch** — site advertises Saturday **9–2** but David's availability
   calendar is **9–5**. Reconcile.
7. **Separate dev Supabase project** — local `.env.local` still points at prod.
8. **★ Restrict the Maps API key (Google Cloud Console — only Mitch can).** The
   one open item from Braden's security review (a real billing-abuse risk if the
   key is unrestricted). Set: **HTTP referrers** `https://forgehandyman.com/*`,
   `https://*.forgehandyman.com/*` (+ `http://localhost:3000/*` for dev); **API
   restriction** = Maps JavaScript API, Places API (New), Geocoding API only.
   (Code + CSP are already correct.) See `reference_maps_api_config.md`.

---

## Branch / commit map

| Branch | HEAD | Meaning |
|---|---|---|
| `main` | `44c32ab` | **production** — everything in "What shipped" is merged + live |
| `feat/sms-consent` | `3d99fc3` | SMS-consent line — **HELD, not deployed** (deploy when Twilio SMS goes live) |
| (merged into main today) | | `feat/editable-crm`, `feat/services-menu-audit`, `fix/quote-idempotency`, `fix/turnstile-and-address`, `feat/customer-lead-ack-email`, `feat/expand-service-radius`, `feat/metro-coverage-copy`, `feat/add-holly-springs-fuquay`, `fix/availability-and-upload-hardening`, `fix/hammer-animation` |

---

## Gotchas the next session must know

- **Prod is LIVE on Stripe.** Real cards can be charged through the quote flow;
  fix Pending #1 before real volume.
- **Prod pushes are gated** — pushing to `main` / migrating the prod DB needs an
  explicit, per-action "yes deploy this" from Mitch. "build it" is not enough.
- **`feat/sms-consent` must stay out of deploys** until SMS goes live — every
  merge-to-main verifies it isn't included.
- **DATA_BACKEND=postgres is LIVE.** Local `.env.local` = the **production**
  Supabase project — local work hits live data. (Customer CRM surfaces are
  postgres-only via `crmEnabled()`; locally they show the "on Postgres" notice
  unless DATA_BACKEND=postgres is set.)
- **`"use server"` files can't export types** — Turbopack treats every export as
  a Server Action; a type export passes `tsc` but fails `next build`. Keep shared
  types in plain modules (e.g. `app/admin/customers/form-types.ts`).
- **Vercel CLI in a no-TTY background shell** prints odd output — confirm deploy
  status with a foreground `vercel ls`.
- **Vercel Sensitive env vars are write-only**; **Hobby cron is daily-only**.
- **Don't use multi-agent workflows for simple checks** (Mitch's feedback) — ask
  or run a quick probe instead.

---

## Pointers

- **Memory (auto-loaded):** `~/.claude/projects/-Users-mbaney-forge-handyman/memory/`
  — `MEMORY.md` index, `project_editable_crm.md` (CRM + MCP-deferred decision,
  NEW this session), `project_crm_build.md`, `project_forge_family.md`,
  `feedback_workflow_restraint.md`, `feedback_no_checkpoint_questions.md`,
  `reference_maps_api_config.md`, `user_mitch.md`.
- **Docs:** `docs/go-live-runbook.md`, `docs/stage-13-postgres-design.md`,
  `docs/stage-14-crm-interface-design.md`.
- **How we work:** design → adversarial critique → build → independently-verified
  review → live verification → commit. Keep doing it.
