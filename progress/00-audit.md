# Phase 0 — Repo Audit & Stage 0 Checklist

Date: 2026-05-22
Branch: `main`
Reviewer: Claude (Opus 4.7), supervised by Mitch

This document captures the state of the codebase before Stage 1 of the production-readiness build begins, and tracks the external-account provisioning Mitch is responsible for outside the repo.

---

## Repo audit findings

### Existing surface

- Next.js 14.2.5 App Router marketing site
- Five page routes: `/`, `/about`, `/services`, `/contact`, plus `app/not-found.tsx`
- One API route: `app/api/contact/route.ts`
- One reusable form component: `components/ContactForm.tsx`
- `lib/google.ts` — Google Workspace integration helpers (Gmail send, Calendar event create, Sheets append) via service-account JWT with domain-wide delegation
- `lib/geocoding.ts` — service-area gate using Google Geocoding API + Haversine distance check (15-mile radius from Garner, NC)
- TypeScript strict mode is ON
- `npm` as the package manager
- No tests, no CI, no pre-commit hooks today

### Existing contact form behavior (the thing we must not break)

Captured here so future-Mitch and future-Claude can verify the new implementation preserves the user-visible behavior:

**Form fields** (`components/ContactForm.tsx`): name, phone, email, address, service type, preferred date, description, referral source.

**Server-side flow** (`app/api/contact/route.ts`):
1. Rate limit (10/hr per IP via in-memory `Map` — silently broken on Vercel serverless, see below)
2. Validate field lengths + basic regex
3. Geocode address; reject if outside 15-mile radius (fail-open if `GOOGLE_GEOCODING_API_KEY` missing)
4. If `NEXT_PUBLIC_DEV_MODE === "true"`, log to console and return success — no API calls
5. Otherwise: send Gmail notification (blocks; returns 502 on failure)
6. Fire Calendar event create + Sheet append in `Promise.allSettled` (non-blocking)

**Sheet schema today** (`Sheet1!A:J`, 10 columns):
1. Submitted At (ISO)
2. Name
3. Phone
4. Email
5. Address
6. Service Type
7. Preferred Date
8. Description
9. Referral Source
10. Status (hardcoded "New")

**Gmail email**: From & To = `BUSINESS_EMAIL`, Reply-To = submitter, Subject `New Job Request: {serviceType} — {name}`, HTML+text body with all fields.

**Calendar event**: Calendar = `GOOGLE_CALENDAR_ID`, title `{serviceType} — {name}`, 1-hour duration, location = address, 30-min popup reminder.

### Security posture — current state

| Concern | Status |
|---|---|
| Secrets in git history | **Clean.** Earlier "private key" scanner hit was a false positive on `.env.example`'s literal `...` placeholder. |
| `.gitignore` | Covers `.env*`. As of Stage 1, also blocks `*.pem`, `*.key`, `credentials*`, `service-account*`. |
| Security headers | Partial: `vercel.json` sets `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, `Permissions-Policy`. Missing HSTS, CSP, and `X-Frame-Options: DENY` (stricter). Stage 1 centralizes all headers in `middleware.ts`. |
| Rate limiting | In-memory `Map` in `app/api/contact/route.ts`. **Silently broken on Vercel serverless** — each cold invocation starts fresh and they don't share state. Stage 1 replaces with Upstash. |
| Input validation | Ad-hoc length checks + regex. Stage 1 replaces with Zod schemas. |
| Logging | `console.error` only, with no PII scrubbing. Stage 1 replaces with Pino + auto-scrub of `phone`/`email`/`address`/`name` fields. |
| Error tracking | None. Stage 1 wires Sentry. |
| Auth | None — there is no admin surface today. Stage 1 scaffolds NextAuth + Google provider locked to `ADMIN_ALLOWLIST` env var. |
| CSRF | None explicit. NextAuth handles it for admin routes once Stage 1 lands. |
| Pre-commit secret scan | None. Stage 1 adds `husky` + `lint-staged` + a secret-scan rule. |

### `npm audit` baseline (before Stage 1 bump)

4 high, 6 moderate vulnerabilities — all in the Next.js / eslint-config-next dependency tree:

| Package | Severity | Notes |
|---|---|---|
| `next` | High (multiple CVEs) | Fixed by patch-bumping to `14.2.35` (latest in v14) |
| `eslint-config-next` 14.x | High | The `glob` CLI command-injection vuln. Only fully cleared by major bump to `eslint-config-next@16`. **Dev-only impact** — we never invoke `glob -c` at runtime. Patch-bumping eslint-config-next to 14.2.35 carries the same dev-only residual; the major bump is deferred until we adopt Next 15+. |
| `gaxios` | Moderate | Transitive via `googleapis`. Pending upstream patch. |
| `brace-expansion` 5.0.2–5.0.5 | Moderate | Transitive. Likely resolved by `npm update` of dev deps. |

**Stage 1 acceptance criterion for audit:** zero highs/criticals from runtime deps. The eslint-config-next dev-only residual gets documented with an issue link and re-evaluated when we bump Next major.

### Discovery: contact form has never fired in production

Looking at Vercel env vars on 2026-05-22, the following are **not present**:
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_ID`
- `GOOGLE_CALENDAR_ID`
- `BUSINESS_EMAIL`
- `GOOGLE_GEOCODING_API_KEY`

Combined with `NEXT_PUBLIC_DEV_MODE=true` in Production, the contact form has been **logging to console only** since the site shipped. No emails sent. No calendar events. No sheet rows. This simplifies Stage 2: there's no production data to migrate.

---

## Stage 0 — Mitch's external-account checklist

This is the live tracker for the accounts Mitch needs to provision out-of-band. Stages that depend on each account can't start until the env vars below are pasted into Vercel.

### Done

- [x] **DNS** — `forgehandyman.com` records added at Namecheap → Vercel
- [x] **Google Cloud project** — `forge-handyman` created (No organization, owned by `admin@forgehandyman.com`)
- [x] **Google Cloud APIs enabled** — Gmail, Calendar, Sheets, Geocoding
- [x] **OAuth consent screen** — External user type, app name `Forge Handyman Admin`, support email `admin@forgehandyman.com`, in Testing mode with self as test user
- [x] **OAuth client ID** — `Forge Handyman Admin Login`, web app, origins `https://forgehandyman.com` + `http://localhost:3000`, redirect URIs `https://forgehandyman.com/api/auth/callback/google` + `http://localhost:3000/api/auth/callback/google`
- [x] **Upstash Redis** — regional db in `us-east-1`
- [x] **Sentry** — Next.js project under org `forge-handyman`
- [x] **Cloudflare Turnstile** — widget `forge-handyman`, hostnames `forgehandyman.com` + `localhost`, Managed mode, site + secret keys obtained

### Pending

- [ ] **Twilio account + A2P 10DLC registration** — blocked on NC Secretary of State LLC approval. A2P brand registration verifies EIN + legal business name against state filings; submitting before the LLC is official will bounce. Pick back up the day SoS approval lands; A2P approval itself then takes several business days. *Blocks Stage 4.*
- [ ] **Stripe (test mode) account** — restricted keys: one for server scope (read/write customers + payment_intents + setup_intents + checkout_sessions + charges + refunds), one separate dev/test key. *Blocks Stage 3.*
- [ ] **New service account for Gmail/Calendar/Sheets** — handled alongside the Stage 2 contact-form rewrite. We'll create one in the existing `forge-handyman` Google Cloud project, enable domain-wide delegation, authorize the scopes in Workspace Admin, and paste credentials into Vercel.
- [ ] **2FA on every account** — Google Workspace (hardware key or Authenticator, not SMS), Stripe, Twilio, Vercel, Cloudflare, Upstash, Sentry, Namecheap, GitHub. Mitch's manual task.

### Decisions explicitly made

- **Make.com is out.** Replaced with direct cron-driven automation inside the Next.js app at Stage 6. One less account, one less recurring bill.
- **GCS bucket is out.** Replaced with daily backup email to Mitch at Stage 7. One less piece of cloud infrastructure to manage.
- **Stripe live mode is deferred to Stage 8.** All payment-rail work in Stage 3 runs against test mode only.

---

## Vercel env vars — master list

### Already added

| Var | Sensitive | Scope |
|---|---|---|
| `GOOGLE_CLIENT_ID` | No | All envs |
| `GOOGLE_CLIENT_SECRET` | Yes | Prod + Preview |
| `NEXTAUTH_URL` | No | All envs (`https://forgehandyman.com`) |
| `NEXTAUTH_SECRET` | Yes | Prod + Preview |
| `ADMIN_ALLOWLIST` | Sensitive | Prod + Preview (`admin@forgehandyman.com`) |
| `NEXT_PUBLIC_SITE_URL` | No | Production (pre-existing) |
| `NEXT_PUBLIC_DEV_MODE` | No | Production (pre-existing — currently `true`, set to `false` when Stage 2 ships) |

### To add this week (accounts already created, values just need pasting)

| Var | Sensitive | Source |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | No | Upstash db page → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Same |
| `SENTRY_DSN` | No | Sentry project setup |
| `SENTRY_ORG` | No | Sentry org slug |
| `SENTRY_PROJECT` | No | Sentry project slug |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | No | Turnstile widget page |
| `TURNSTILE_SECRET_KEY` | Yes | Same |

### To add as their stages land

| Var | Sensitive | Stage |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | No | 2 |
| `GOOGLE_PRIVATE_KEY` | Yes | 2 |
| `GOOGLE_SHEET_ID` | No | 2 |
| `GOOGLE_CALENDAR_ID` | No | 2 |
| `GOOGLE_GEOCODING_API_KEY` | Yes | 2 |
| `BUSINESS_EMAIL` | No | 2 |
| `STRIPE_SECRET_KEY_TEST` | Yes | 3 |
| `STRIPE_WEBHOOK_SECRET_TEST` | Yes | 3 |
| `STRIPE_PUBLISHABLE_KEY_TEST` | No | 3 |
| `STRIPE_SECRET_KEY_LIVE` | Yes | 8 |
| `STRIPE_WEBHOOK_SECRET_LIVE` | Yes | 8 |
| `STRIPE_PUBLISHABLE_KEY_LIVE` | No | 8 |
| `TWILIO_ACCOUNT_SID` | No | 4 |
| `TWILIO_AUTH_TOKEN` | Yes | 4 |
| `TWILIO_PHONE_NUMBER` | No | 4 |
| `TWILIO_MESSAGING_SERVICE_SID` | No | 4 |
| `DAVID_HEADS_UP_TOKEN` | Yes | 4 |
| `UNSUBSCRIBE_HMAC_SECRET` | Yes | 6 |
| `SENTRY_AUTH_TOKEN` | Yes | 1 (build-time, source-map upload — optional initially) |
| `CONTACT_FORM_DISABLED` | No | 8 (kill switch; defaults unset/false) |
| `AUTOMATIONS_DISABLED` | No | 6 (kill switch; defaults unset/false) |

---

## Annual secret-rotation policy

Set a calendar reminder for **every 12 months** to rotate:

- `STRIPE_SECRET_KEY_LIVE` (regenerate restricted keys in Stripe dashboard)
- `STRIPE_WEBHOOK_SECRET_LIVE` (rotate via Stripe webhook endpoint)
- `TWILIO_AUTH_TOKEN`
- `GOOGLE_PRIVATE_KEY` (regenerate service-account JSON key)
- `NEXTAUTH_SECRET`
- `UNSUBSCRIBE_HMAC_SECRET`
- `UPSTASH_REDIS_REST_TOKEN`
- `TURNSTILE_SECRET_KEY`
- `DAVID_HEADS_UP_TOKEN`

After each rotation: update Vercel env, redeploy, verify the old credential is rejected.

---

## What ships in Stage 1 (preview)

The next progress doc (`progress/01-security-foundations.md`) will detail what landed. At a high level, Stage 1 adds:

- Tightened `.gitignore`, husky + lint-staged + secret-scan pre-commit hook
- Next.js patch bump to clear runtime CVEs
- Stage 1 deps: zod, pino, @sentry/nextjs, next-auth, @upstash/{ratelimit,redis}, libphonenumber-js
- `lib/security/{logger,rate-limit,zod}.ts`
- `lib/webhooks/{idempotency,verify}.ts`
- `middleware.ts` (security headers, CSP, `/admin` auth gate)
- `instrumentation.ts` (Sentry init with PII scrubbing)
- `app/api/auth/[...nextauth]/route.ts` (Google provider + allowlist)
- Updated `.env.example`

Nothing user-visible changes in Stage 1. The contact form, the marketing pages, and the dev-mode toggle all continue to work exactly as before.
