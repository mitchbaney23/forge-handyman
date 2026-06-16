# Forge Handyman — Session Log

**Session span:** 2026-06-12 → 2026-06-16
**Driver:** Mitch Baney (owner; directs, doesn't write code)
**What this session did:** Took Forge from a marketing site + Google-Sheet CRM
to an agent-native CRM on Postgres (built, mostly shipped behind a flag),
launched a flat-rate **service menu**, and built a time-aware **booking cart**.

This file is the handoff for the next session. The live, terse project state
also lives in the memory files (see "Pointers" at the bottom) — read those first.

---

## TL;DR — current state

| Thing | State |
|---|---|
| Marketing site + booking form | **Live** (forgehandyman.com) |
| Flat-rate **service menu** page | **Live** (merged to main) |
| Postgres CRM (Phases A + B) | **Code live in prod, dormant behind `DATA_BACKEND=sheet`** |
| Supabase project | **Created + schema applied** (dev), not yet production backend |
| **Booking cart** | **Built + reviewed on branch `feat/booking-cart`**, NOT merged (awaiting Mitch's go) |
| Production **data cutover** to Postgres | **Blocked** on Mitch's Google private key |
| Stripe | **TEST mode** in prod (no live keys yet) |
| Phone number on site | still `(555) 123-4567` placeholder (Twilio number pending) |

`main` HEAD = `66b947e`. Production deploys from `main` (Vercel, auto on push).

---

## What we built, in order

### 1. Phase A — Postgres foundation (Stage 13)  ✅ shipped (dormant)
Swapped the data layer from Google Sheets to Supabase Postgres **behind a
`DATA_BACKEND` flag** (`sheet` default | `postgres`), zero behavior change.
- Mapped the entire Sheet data layer + every call site (fan-out workflow).
- Schema designed, hardened by a **4-lens adversarial critique** (caught 3
  blockers: anonymization PII gap, the Sheets `'TRUE'`-vs-`'true'` boolean
  trap, the PostgREST 1000-row cap).
- Built: `db/schema.sql`, `lib/data/` (per-call backend switch + pg repo/
  queries/audit/export/mappers preserving the all-strings `ContactRow`
  contract), `scripts/migrate-sheet-to-db.ts` (dry-run/execute/verify),
  vitest + GitHub Actions CI.
- **5-lens review caught a real blocker**: the migration stashed raw PII in
  `jobs.legacy`, which the deletion-request flow couldn't reach → fixed
  (`redactJobLegacyByIds`).
- Branch `stage/13-postgres-foundation`, commit `7d506a9`.

### 2. Phase B1 — CRM read surfaces (Stage 14)  ✅ shipped (dormant)
`/admin` becomes a real CRM (postgres-only; sheet mode shows "available on
Postgres" notices).
- Customer profiles (`/admin/customers`, keyed on stable UUID), Properties
  view (landlords), per-job **activity timeline**, an **activity vocabulary**
  with `claude` as a first-class actor (the Phase E hook), `customer_summary`
  SQL view.
- 4-lens review: 3 confirmed (a same-page `property_count` view bug — fixed +
  **live-verified**; note-length caps; an anonymization read-guard).
- Branch `stage/14-crm-interface`, commit `470d03e`. 105 tests; live-Postgres
  integration verified.

### 3. Phase B2 — money-path integrity  ✅ shipped (dormant, postgres-gated)
- **Double-charge guard**: a `payments` row claimed BEFORE the Stripe call via
  the `claim_charge_attempt` RPC + a partial unique index. Stripe idempotency
  keys expire at 24h then re-charge — this row is the *durable* guard.
- `markComplete` reworked (claim → charge → record → Complete; webhook is an
  idempotent backstop). Payments ledger (deposit/balance/refund). Status-
  machine guard (no hand-set Complete). `isSameLocalDay` → Eastern time.
  Pipeline surfaces the orphaned statuses.
- **Two real money bugs caught & fixed**: (a) a live test found the claim RPC
  returned an all-null row on conflict, read as "won the gate" (double-charge
  trap); (b) the review found a **3DS (`requires_action`) gate-leak** enabling
  a post-24h double-charge. Both fixed and **live-verified** against the DB.
- Commit `ece1cb8`. 127 tests.

### 4. Supabase project created
`forge-handyman` (ref `nkvsgvlyxwdsvklxypwu`, us-east-1) created via CLI,
schema applied via `supabase/migrations/*`, all 7 tables verified through the
app's data path. Dev creds in gitignored `.env.local`.

### 5. Pushed all code to prod (sheet mode)
Merged `stage/14` → `main` → deployed. **Production runs in SHEET mode** (flag
unset); the entire CRM is live-but-dormant. `/api/health` confirms
`backend: sheet`. No behavior change for customers.

### 6. Flat-rate **service menu** page  ✅ LIVE
- Pricing strategy worked out with Mitch: **flat-rate per task, $85/hr, $95
  minimum**, grounded in NC-market research.
- `/services` rebuilt as a posted **menu**: 5 sections (General Repairs,
  Installation & Furniture Assembly, Painting & Drywall, Minor Plumbing, TV
  Mounting — **Outdoor & Seasonal dropped**), 3 numbered **packages** (#1
  Honey-Do 2h/$169, #2 Half-Day 4h/$329, #3 Full Day 8h/$629).
- Merged to `main` (`66b947e`) — **live on the site.** Also produced a menu
  mockup widget for Mitch to refine in Claude Design.

### 7. Time-aware **booking cart**  🟡 built, on branch, awaiting go
The booking form's step 1 is now "Build your job": packages-forward, then à la
carte menu items, a running **$ + time** total, and a **nudge to a package**
once the list crosses ~2 hours. The "not sure / custom job" door stays.
- `lib/cart.ts` (cart math), `ContactForm` step-1 rewrite, contact route +
  Zod schema consume the cart (back-compat preserved), Telegram card shows the
  package/order. Booking categories now match the menu (Electrical etc. gone).
- **Verified live in preview** (selection, totals, the nudge) + 145 tests +
  a 4-lens lead-capture review (6 minor, **0 blockers**, all fixed).
- Branch `feat/booking-cart`, commit `f073f29`, pushed (Vercel preview built).
  **NOT merged** — Mitch test-drives, then says "ship it" to merge to prod.

---

## Branch / commit map

| Branch | HEAD | Meaning |
|---|---|---|
| `main` | `66b947e` | **production** — Phase A+B (dormant) + the live service menu |
| `feat/booking-cart` | `f073f29` | the cart, ready to merge to main |
| `stage/13-postgres-foundation` | `7d506a9` | Phase A (ancestor of main) |
| `stage/14-crm-interface` | `ece1cb8` | Phase B1+B2 (ancestor of main) |
| `feat/services-menu` | `66b947e` | the menu (already merged) |

---

## Pending — needs Mitch (action items)

1. **Ship the cart**: test-drive the Vercel preview, then say "ship it" → merge
   `feat/booking-cart` → `main`.
2. **Production data cutover to Postgres** — BLOCKED on the **Google service-
   account private key** (Vercel keeps it write-only; it can't be pulled).
   To finish: paste the key locally → run `scripts/migrate-sheet-to-db.ts`
   (dry-run → execute) → add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to
   Vercel (Production, Sensitive) → set `DATA_BACKEND=postgres` → redeploy →
   `/api/health` shows `backend: postgres`. Use the freeze procedure in
   `progress/13-postgres-foundation.md`. (Or, if the Sheet has few leads,
   start Postgres fresh and re-enter them.)
3. **Twilio phone number** → replaces `(555) 123-4567` in `BUSINESS.phone`
   (`lib/constants.ts`), which is in the site header, mobile Call button, and
   booking confirmations.
4. **Stripe live keys** (checking account now exists) → the go-live runbook in
   `docs/go-live-runbook.md` (business verification + live restricted key +
   live webhook; the code auto-selects live keys when present).
5. **Real mailing address** — `BUSINESS.mailingAddress` is still
   `PO Box 0000` (CAN-SPAM requires a real one before automated emails).

---

## Gotchas the next session must know

- **`DATA_BACKEND` flag**: unset/`sheet` = Google Sheet (prod today);
  `postgres` = Supabase. Cutover = freeze + migrate + flip. Never one-shot it.
- **Vercel Sensitive env vars are write-only** — `vercel env pull` returns
  `""` for them (GOOGLE_PRIVATE_KEY, NEXTAUTH_SECRET, Stripe keys, etc.). You
  cannot retrieve secrets from Vercel; Mitch must supply them.
- **Prod is Stripe TEST mode** (no live keys) — real money isn't at risk yet.
- **Vercel Hobby plan**: cron jobs are **daily-only**; a sub-daily cron in
  `vercel.json` silently fails the whole deploy.
- **Production deploys come from a `main` push** (auto). `vercel --prod` is
  blocked by the sandbox classifier.
- **Both CLIs are authed locally**: `supabase` (Mitch's account, org
  `hedvxndzzieuvomqvqed`) and `vercel` (`mitchbaney23`, project linked).
- The cart stores only a **formatted** summary + derived categories — the raw
  structured cart isn't persisted yet (future `cart_json` for quote-from-cart).

---

## The plan from here (phases not yet built)

- **Phase C** — scheduling + Google Calendar sync + **Telegram → David's daily
  agenda** (the approve/decline buttons retire; he just gets where/when/what).
- **Phase D** — price book wired into quotes (`catalog_items`) + persist the
  structured cart so quotes build from the customer's selections.
- **Phase E** — MCP server + approval queue + scheduled routines (the layer
  where Claude actively co-runs leads/follow-ups). The activities table + the
  `claude` actor are already laid for this.
- **Phase F** — invoicing + per-job costing + reporting (margin by job type,
  lead-source ROI).

---

## Pointers

- **Memory (cross-session, auto-loaded):**
  `~/.claude/projects/-Users-mbaney-forge-handyman/memory/` — `MEMORY.md` index,
  `project_crm_build.md` (live state of this build), `project_forge_build.md`
  (the earlier production-readiness build), `user_mitch.md`, feedback notes.
- **Design specs:** `docs/stage-13-postgres-design.md` (v2, post-critique),
  `docs/stage-14-crm-interface-design.md` (v2).
- **Progress docs:** `progress/13-postgres-foundation.md`,
  `progress/14-crm-interface.md`, plus `docs/go-live-runbook.md`.
- **How we work:** design → adversarial multi-agent critique → build →
  independently-verified review → live verification → commit. It has caught a
  real bug in every phase, especially the money paths. Keep doing it.
