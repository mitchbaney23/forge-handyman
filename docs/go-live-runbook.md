# Go-Live Runbook — the day the LLC clears

Everything in this list is **blocked on the NC Secretary of State LLC approval**. Once the LLC is official (verified legal name + EIN), work through this top to bottom to flip Forge from test mode to taking real customer money + sending real SMS. Estimated total: a focused half-day plus A2P approval wait (days).

## 0. Prerequisites (confirm before starting)

- [ ] LLC approved by NC SoS; you have the exact legal business name + EIN
- [ ] Business bank account open (Stripe payouts need it)
- [ ] 2FA enabled on every account (Google, Vercel, Stripe, Cloudflare, Upstash, Sentry, Namecheap, GitHub)
- [ ] `BUSINESS.mailingAddress` in `lib/constants.ts` replaced with the real PO box / address (placeholder is `PO Box 0000` — CAN-SPAM requires a real one)

## 1. Stripe → live mode

- [ ] Stripe Dashboard → complete **business verification** (legal name, EIN, address, bank account)
- [ ] Set the statement descriptor to `FORGE HANDYMAN`
- [ ] Turn on customer email receipts (Settings → Customer emails) with Forge branding
- [ ] Generate **live** restricted API key (`rk_live_…`) with the same scopes as the test key: write customers / charges / payment_intents / setup_intents / checkout_sessions / payment_links / products / prices / refunds; read webhook_endpoints
- [ ] Grab the live **publishable** key (`pk_live_…`)
- [ ] Create a **live** webhook endpoint → `https://forgehandyman.com/api/webhooks/stripe`, same 5 events (checkout.session.completed, payment_intent.succeeded, payment_intent.payment_failed, customer.created, charge.refunded). Reveal its signing secret (`whsec_…`)
- [ ] Add to Vercel (sensitive, Production): `STRIPE_SECRET_KEY_LIVE`, `STRIPE_PUBLISHABLE_KEY_LIVE`, `STRIPE_WEBHOOK_SECRET_LIVE`
- [ ] Redeploy. `lib/stripe/client.ts` auto-selects live keys when `STRIPE_SECRET_KEY_LIVE` is present.

## 2. Live-mode smoke test (real card, $1)

- [ ] Submit a real contact form → send yourself a quote with a $1 deposit + small balance
- [ ] Pay the deposit with a **real** card → confirm: receipt email arrives, webhook fires, sheet flips to `Booked`, customer + payment-method IDs saved
- [ ] Mark the job Complete in `/admin` → confirm the balance auto-charges the saved card
- [ ] Refund both charges from the Stripe dashboard → confirm `charge.refunded` webhook updates the sheet status
- [ ] Confirm the Audit tab logged each step

## 3. Twilio + A2P 10DLC (start early — approval takes days)

- [ ] Create Twilio account; provision a local 919/984 number (~$1.15/mo)
- [ ] Register the **A2P 10DLC brand** as a Sole Proprietor / LLC using the verified EIN + legal name
- [ ] Register the **campaign** with use case "Customer Care"
- [ ] Wait for carrier approval (typically a few business days)
- [ ] Generate Twilio API key + auth token; add to Vercel (sensitive): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`
- [ ] Generate `DAVID_HEADS_UP_TOKEN` (`openssl rand -hex 32`) for David's bookmark endpoint
- [ ] **Note:** the Twilio SMS feature itself (Stage 4) is not yet built — `lib/twilio/` doesn't exist. Building it is a separate coding stage once A2P is approved. This runbook just captures the account setup so it's ready.

## 4. Final pre-launch checks

- [ ] `NEXT_PUBLIC_DEV_MODE` is `false` (or unset) in Production — confirm submissions actually fire Gmail/Calendar/Sheet
- [ ] `CONTACT_FORM_DISABLED` is unset/false
- [ ] `UNSUBSCRIBE_HMAC_SECRET`, `CRON_SECRET`, `GOOGLE_REVIEW_URL` all set
- [ ] `/api/health` returns all green
- [ ] UptimeRobot monitor active on `/api/health`
- [ ] Sentry alert rules live (payment errors, webhook-signature spike, admin auth-failure spike)
- [ ] Privacy + Terms pages reviewed; mailing address is real
- [ ] Run `npm audit` — no new high/critical
- [ ] Mozilla Observatory scan of the live site → target A or better

## 5. Sign-off

- [ ] Mitch processes one real customer end-to-end and confirms the full lifecycle
- [ ] Record "Production approved — {date}" in `progress/` and announce the business is live

---

**Reminder:** the code rails for all of this (Stripe charge/refund/webhook, the admin flip-to-complete flow, the follow-up automation) are already built and tested in sandbox. Going live is configuration + verification, not new construction — except the Twilio SMS feature, which is the one remaining build (Stage 4) and only starts after A2P approval.
