# Stage 5b — Admin Quotes + Pipeline

Date: 2026-05-25
Branch: `stage/05b-admin-quotes`

Part 2 of Stage 5. Adds the quote-sending UI (the main operational unlock — you can now generate Stripe Payment Links from the admin dashboard instead of from the Stripe console) and a kanban-style pipeline view.

---

## What shipped

### Pages

| Path | Behavior |
|---|---|
| `/admin/quotes/[id]` | Per-job quote composer. Pre-fills customer name, email, service, and description from the sheet row. You set: tier (small/medium/large), deposit (USD), balance (USD), optional description override. Submit creates a Stripe Payment Link with `setup_future_usage: 'off_session'` (saves card for the later balance auto-charge), sends a branded email to the customer with the link, flips the job status to `Quoted`, and writes `balance_owed_cents` to the sheet. |
| `/admin/pipeline` | 5-column kanban view: New / Quoted / Booked / In Progress / Complete. Oldest jobs at the top of each column. Cards older than a per-column staleness threshold (24h for New, 7d for Quoted, 14d for Booked, 48h for In Progress) get a `stalled` badge so they surface. |

### Code

| File | Purpose |
|---|---|
| `lib/email/quote.ts` | New module. `sendQuoteEmail()` — Gmail-via-service-account, branded HTML email with deposit/balance/total breakdown and a big "Pay deposit & book the date" CTA button linking to the Payment Link. Plain-text fallback included. |
| `app/admin/quotes/[id]/actions.ts` | Server action `sendQuote()`. Verifies admin session, applies `admin-action` rate limit, validates inputs (deposit ≥ $1, balance ≥ $0, tier in enum), creates Payment Link via Stage 3's `createQuotePaymentLink()`, sends the email, updates the sheet row, writes Audit row. Handles partial-failure gracefully (e.g., Payment Link created but email failed → tells you to send manually). |
| `app/admin/quotes/[id]/QuoteComposer.tsx` | Client component for the composer form. Live total computation. Success state shows the Payment Link URL for your records (so you can verify it or re-send via another channel). |
| `app/admin/quotes/[id]/page.tsx` | Server component that loads the job row, gates on its existence, and renders the composer. |
| `app/admin/pipeline/page.tsx` | Server component that lists all jobs, groups by status, and renders the 5-column kanban with staleness badges. |
| `app/admin/jobs/[id]/page.tsx` | Updated — added a prominent "Send Quote" CTA to the header when status is `New` / `Quoted` / `Pending Follow-Up`. Re-send shows for jobs that already have an open Payment Link. |
| `app/admin/layout.tsx` | Updated — Pipeline nav link in the top bar. |

### Behavior changes — what the customer sees

When you compose and send a quote:
- Customer gets a branded email from `admin@forgehandyman.com` with subject `Your quote from Forge Handyman — {service type}`
- Email contains: friendly intro, the description, deposit + balance + total breakdown, "Pay deposit & book the date" button, expiration date (7 days from send)
- Clicking the button takes the customer to Stripe's hosted checkout (Stripe handles all card collection — never touches our servers)
- After paying the deposit, the `checkout.session.completed` webhook fires (Stage 3 handler), flips the job to `Booked`, saves the customer + payment_method IDs to the sheet for the later balance auto-charge

### Behavior changes — what Mitch sees

- New `/admin/pipeline` link in the top nav
- "Send Quote" button on every job detail page when status is `New` / `Quoted` / `Pending Follow-Up`
- New `/admin/quotes/[id]` page when you click that button — composer form with live total calculation
- Success state shows the generated Payment Link URL so you can copy it for your records or re-send via another channel

---

## Verification performed during development

| Check | Result |
|---|---|
| `npm audit` | unchanged (0 high, 0 critical) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — new routes `/admin/quotes/[id]`, `/admin/pipeline` registered |

---

## Live smoke test (after merge + deploy)

This is the moment you can verify the entire Stage 3 payment lifecycle end-to-end. Requires Stripe sandbox env vars in Vercel (`STRIPE_SECRET_KEY_TEST`, `STRIPE_WEBHOOK_SECRET_TEST`, `STRIPE_PUBLISHABLE_KEY_TEST`).

1. **Submit a test contact form** at `forgehandyman.com/contact` — use your own email so the customer-facing emails land in your inbox. The job appears on `/admin` under "Needs triage."
2. **Open the new job** — click into its detail page. Top right shows "Send Quote".
3. **Send the quote:**
   - Pick tier (Medium)
   - Deposit: 50.00
   - Balance: 100.00
   - Description: optional override
   - Hit "Create & Send Quote"
4. **Verify two things land:**
   - A Stripe Payment Link is created (visible in your Stripe sandbox dashboard → Payment Links)
   - The email arrives in your inbox with the "Pay deposit & book the date" button
5. **Sheet check:** the row now shows `status=Quoted`, `balance_owed_cents=10000` (the balance in cents). Audit tab has a new row with `action=quote.sent`.
6. **Pay the deposit:** click the button in the email → Stripe-hosted checkout opens. Use test card `4242 4242 4242 4242` with any future expiry, any CVC, any ZIP. Pay.
7. **Webhook fires:** Stripe sends `checkout.session.completed` to `/api/webhooks/stripe`. Stage 3 handler updates the sheet: `status=Booked`, `stripe_customer_id` populated, `stripe_payment_method_id` populated, `deposit_paid_cents=5000`. Audit row appended.
8. **Refresh `/admin`:** job has moved out of "Needs triage" and now appears in "Today" or "Tomorrow" (depending on `preferred_date`).
9. **Mark Complete:** open the job detail → click "Mark Complete · charge $100.00" → confirmation modal → confirm → server action calls `chargeBalance` which charges the saved card off-session for $100. Sheet flips to `status=Complete`, `balance_owed_cents=0`, `complete_date` stamped. Stripe sandbox shows two payments (deposit + balance).
10. **Refund test** (optional): from the Stripe sandbox dashboard, refund the deposit. `charge.refunded` webhook fires → sheet status flips to `Refunded`.

The whole lifecycle works in sandbox mode end-to-end. When you flip to live mode (Stage 8), the only changes are: swap test keys for live keys, change the webhook endpoint to live mode, and process real customer cards.

---

## Deferred / explicit non-goals for Stage 5b

- **Manual refund button on `/admin`.** `refundCharge()` exists in `lib/stripe/refunds.ts` but no UI yet. For now, do refunds from the Stripe dashboard (the `charge.refunded` webhook still fires and updates the sheet). Worth adding as a polish pass.
- **Payment Link re-send via the same composer.** Today, clicking "Re-send Quote" on a Quoted job opens the composer fresh — you'd recreate a new Payment Link with new amounts. The old link still works (Stripe doesn't auto-expire it until 7 days). If you actually want to "resend the same link," copy it from the audit log or Stripe dashboard.
- **Bulk operations** (e.g., "send quotes to all New jobs"). Out of scope; the per-job composer is the right granularity for Forge's volume.
- **Quote line items.** Today the email shows a single description blob. A future polish could itemize (e.g., "deck board × 12, labor 4h, materials"). Not blocking.
- **3DS authentication flow on balance auto-charge.** When `chargeBalance` returns `requires_action`, current UI tells you to handle it in Stripe dashboard. Plan calls for auto-generating a hosted authentication link and emailing the customer. Punted to a future stage.
- **Job photos.** Coming in a later stage when David's MMS flow (or however he sends pictures) is decided.

---

## Things to watch in the next stage

- **Twilio Stage 4** is still blocked on NC SoS LLC approval. Once approved and A2P 10DLC clears, the same `checkout.session.completed` webhook handler that flips a job to Booked will also fire a booking-confirmation SMS to the customer. Hookpoint is already there.
- **Sentry source-map upload** is still deferred from Stage 1. When Stripe payment errors start appearing in Sentry, readable stack traces will matter. Wire `SENTRY_AUTH_TOKEN` into the build step.
- The `findRowByJobId` function reads the entire sheet on every call. At Forge's scale this is fine. Worth keeping an eye on as volume grows — eventually we'll want a queryable backing store (Postgres/Supabase) instead of a sheet.
