# Stage 3 — Stripe Payment Rails (Test Mode)

Date: 2026-05-22
Branch: `stage/03-stripe` (depends on Stage 1 and Stage 2)

Stage 3 builds the entire Stripe surface in test mode. Live-mode flip is deferred to Stage 8.

---

## What shipped

### Code

| File | What it does |
|---|---|
| `lib/stripe/client.ts` | Stripe SDK init. Reads `STRIPE_SECRET_KEY_LIVE` first, falls back to `STRIPE_SECRET_KEY_TEST`. Exposes `getStripeMode()`, `getWebhookSecret()`, and `buildIdempotencyKey()`. SDK pinned to API version `2026-04-22.dahlia`. |
| `lib/stripe/payment-links.ts` | `createQuotePaymentLink(quote, actor)`. Creates a Product + Price + Payment Link in one shot. `setup_future_usage: 'off_session'` saves the card for the eventual balance auto-charge. Idempotency keys derived from `jobId` so retries don't duplicate. Audit log row written on success. |
| `lib/stripe/charges.ts` | `chargeBalance(input, actor)`. Off-session `PaymentIntent` against the saved card. Idempotency key per jobId. Classifies failures: `succeeded` / `requires_action` (3DS) / `failed`. Recoverable failure codes (`card_declined`, `expired_card`, `insufficient_funds`, `authentication_required`) get flagged separately so the admin dashboard can show the right CTA. |
| `lib/stripe/refunds.ts` | `refundCharge(input, actor)`. Full or partial refund (default full). Idempotency key composes job + charge + amount. Writes audit log on both success and failure. |
| `lib/stripe/webhook-handlers.ts` | Five handlers: `checkout.session.completed` (deposit paid → `Booked`, save customer + payment_method, store deposit amount), `payment_intent.succeeded` (balance-charge → `Complete`, balance owed → `0`), `payment_intent.payment_failed` (status → `Payment Failed`, Sentry alert), `customer.created` (audit only), `charge.refunded` (status → `Refunded` / `Partial Refund`). All look up the sheet row by `metadata.jobId`. |
| `app/api/webhooks/stripe/route.ts` | Webhook receiver. Reads raw body, verifies signature via `stripe.webhooks.constructEvent`, checks idempotency in Upstash (`idemp:stripe:{event.id}` 24h TTL), dispatches by event type. Returns 400 on bad signature, 200 on success, 500 only on dispatch errors (Stripe will retry). |
| `lib/sheet/audit-log.ts` | New module. `appendAuditRow({actor, action, target, before, after, notes})` writes to a separate `Audit` tab in the same spreadsheet. `ensureAuditTab()` creates the tab if missing — called by the setup script. |
| `lib/sheet/repo.ts` | Extended with `findRowByJobId(jobId)` (returns row number + parsed `ContactRow`) and `updateRowByJobId(jobId, updates)` (batchUpdate of specified columns only). |
| `app/api/contact/route.ts` | Now generates a `randomUUID()` job ID on every submission and writes it to the sheet column T. |
| `docs/sheet-schema.md` | Schema documented expanded to 24 columns (A–X) — added T `job_id`, U `stripe_customer_id`, V `stripe_payment_method_id`, W `deposit_paid_cents`, X `balance_owed_cents`. Plus the new Audit tab schema. |
| `scripts/setup-sheet.ts` | Now also creates the `Audit` tab + writes its header row on first run (idempotent). |

### Dependencies

- New runtime: `stripe@22.1.1` — official Node SDK

### Behavior changes (visible)

**None for customers.** Stage 3 ships code that's invoked by the admin dashboard (Stage 5) and by Stripe webhooks (which need an external Stripe account configured). Customers continue to see exactly the same contact form.

**Visible to you, once you configure Stripe:**
- Every contact form submission gets a stable `job_id` UUID written to column T
- Every Stripe webhook event auto-appends a row to the `Audit` tab

---

## Manual checklist for Mitch — needed before Stage 3 actually works

### Step 1 — Create the Stripe account (~10 min)

1. Go to https://dashboard.stripe.com/register
2. Sign up with `admin@forgehandyman.com`
3. Skip the full business verification for now — we want test mode only at this stage
4. **Confirm you're in test mode**: top-right of the dashboard should show "Test mode" toggle. Leave it ON.

### Step 2 — Generate restricted API keys (~5 min)

In Stripe Dashboard (test mode):

1. **Developers → API keys → Restricted keys → Create restricted key**
2. Name: `forge-handyman-server-test`
3. Permissions — grant **Write** access to:
   - Customers
   - Charges
   - PaymentIntents
   - SetupIntents
   - Checkout Sessions
   - Payment Links
   - Products
   - Prices
   - Refunds
4. Permissions — grant **Read** access to:
   - Webhook Endpoints (for webhook signing secret retrieval)
5. **Create**
6. Copy the restricted key (`rk_test_...`) → Vercel as `STRIPE_SECRET_KEY_TEST` (**sensitive**, Prod + Preview)

Also grab the **publishable test key** (`pk_test_...`) from Developers → API keys → Standard keys. Paste to Vercel as `STRIPE_PUBLISHABLE_KEY_TEST` (not sensitive, all envs).

### Step 3 — Set up the webhook endpoint (~5 min)

In Stripe Dashboard (test mode):

1. **Developers → Webhooks → Add endpoint**
2. **Endpoint URL**: `https://forgehandyman.com/api/webhooks/stripe`
3. **Events to send** (select these five exact events):
   - `checkout.session.completed`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.created`
   - `charge.refunded`
4. **Add endpoint**
5. On the endpoint details page, click **Reveal** under "Signing secret"
6. Copy the value (`whsec_...`) → Vercel as `STRIPE_WEBHOOK_SECRET_TEST` (**sensitive**, Prod + Preview)

### Step 4 — Configure account-level settings

In Stripe Dashboard → Settings:

1. **Settings → Business → Public details**:
   - Business name: `Forge Handyman Service` (or whatever your final legal name is once LLC clears)
   - Statement descriptor: `FORGE HANDYMAN` (shows up on customer credit card statements)
2. **Settings → Customer emails**:
   - Email customers about successful payments: ON
   - Email customers about refunds: ON
   - Brand the emails with `Forge Handyman` (logo upload optional)
3. **Settings → Branding**:
   - Brand color: `#1B3A5C` (Forge navy) or whatever matches your site
   - Logo: upload the Forge logo if you have a clean SVG/PNG

### Step 5 — Re-run the sheet setup script

Now that Stage 3 added 5 new columns (T–X) and an Audit tab, re-run:

```bash
vercel env pull .env.local
npm run setup-sheet
```

You should see:
```
✓ Backup created: tab "backup-2026-..."
✓ Header row updated.
✓ Verified header row matches canonical schema.
✓ Created Audit tab with header row.
```

If you already have the Stage 2 schema (19 columns), the script will back it up to a `backup-*` tab and rewrite headers with the new 24-column schema. The Audit tab gets created if missing.

### Step 6 — Smoke test (using Stripe CLI)

Install Stripe CLI: https://docs.stripe.com/stripe-cli — `brew install stripe/stripe-cli/stripe` if you're on Mac.

Then:

```bash
# Authenticate
stripe login

# Forward webhook events to your local dev (or Vercel preview):
stripe listen --forward-to https://your-vercel-preview-url.vercel.app/api/webhooks/stripe

# In another terminal, trigger a test event:
stripe trigger checkout.session.completed
```

You should see:
- 200 response in the `stripe listen` output
- A row in the Audit tab with `action=job.booked`
- Logs in Vercel for the function invocation

---

## Verification performed during development

| Check | Result |
|---|---|
| `npm audit` | 0 high, 0 critical (unchanged) |
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npm run build` | Clean — new route `/api/webhooks/stripe` registered |

End-to-end live testing depends on Mitch completing steps 1–6 above.

---

## Deferred / explicit non-goals for Stage 3

- **Stripe live-mode keys.** Stage 8 launch checklist swaps these in. For Stage 3, test mode only.
- **Customer-facing checkout UI.** Stripe Payment Links use Stripe's hosted page — no UI to build on our side. (Stripe Elements / embedded checkout would be a separate decision, not needed for the deposit/balance flow.)
- **Invocation of `chargeBalance` and `refundCharge`.** Both functions are defined; the admin dashboard in Stage 5 will wire the buttons. Stage 3 just builds the engine.
- **Payment-failed customer recovery email.** Plan calls for auto-emailing the customer a new Payment Link when the balance auto-charge fails. Stage 4 (Twilio) and Stage 5 (admin dashboard) together handle this — Stage 3 only flags the failure in Sentry + sheet.
- **3DS authentication redirect.** When `chargeBalance` returns `requires_action`, the caller needs to generate a hosted authentication URL and email it to the customer. Wired in Stage 5.
- **Tests with the Stripe CLI integrated into CI.** No CI exists yet. Manual `stripe listen` flow documented above.

---

## Things to watch in Stage 4

- **Twilio webhook URL** will follow the same `/api/webhooks/twilio` pattern as Stripe. Same signature-verify + idempotency pattern.
- **Phone number for SMS** — provision in Twilio once A2P 10DLC is approved (blocked on LLC). Stage 4 code can ship even before A2P approval; SMS sending will return a dry-run flag if Twilio env vars aren't set.
- **Cross-stage data flow**: when a `checkout.session.completed` webhook fires, Stage 4's Twilio integration will send the customer a booking confirmation SMS. Today (end of Stage 3), the handler just updates the sheet row; Stage 4 will hook the SMS send into the same handler.
