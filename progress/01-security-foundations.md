# Stage 1 — Security Foundations

Date: 2026-05-22
Branch: `main`
PR: (commit-only on `main` — no PR yet since this is the initial security baseline)

This document records what shipped in Stage 1 of the Forge Handyman production-readiness build. Stage 1 is the foundation: nothing else in the plan can land cleanly without these primitives in place.

---

## What shipped

### Dependency upgrades

| Package | Before | After | Reason |
|---|---|---|---|
| `next` | 14.2.5 | 16.2.6 | Multiple high-severity CVEs in Next 14, including XSS in App Router CSP nonces — directly relevant since this stage implements CSP nonces. Not all CVEs were backported to v14; the only clean fix is the major bump. |
| `react` | 18.3.1 | 19.x | Peer dependency of Next 16. |
| `react-dom` | 18.3.1 | 19.x | Same. |
| `@types/react` | 18.3.3 | 19.x | Match installed React. |
| `@types/react-dom` | 18.3.0 | 19.x | Same. |
| `eslint` | 8.57.0 | 9.x | Peer dependency of `eslint-config-next@16`. |
| `eslint-config-next` | 14.2.5 | 16.2.6 | Clears the `glob` CLI command-injection vuln in `@next/eslint-plugin-next`. |

### New runtime dependencies

- `zod` — schema-validation library used by `lib/security/zod.ts` and all future API routes
- `pino`, `pino-pretty` — structured logging with PII auto-redaction
- `@sentry/nextjs` — error tracking and alerting
- `next-auth` (v4 — stable; v5 is still beta) — Google OAuth admin login
- `@upstash/ratelimit`, `@upstash/redis` — distributed rate limiting and webhook idempotency (replaces the broken in-memory `Map`)
- `libphonenumber-js` — E.164 phone normalization

### New dev dependencies

- `husky` — git hook manager
- `lint-staged` — runs commands against staged files only
- `secretlint`, `@secretlint/secretlint-rule-preset-recommend` — pre-commit secret scanner (rejects commits containing Stripe keys, AWS keys, GitHub PATs, Google API keys, etc.)

### New files

| File | Purpose |
|---|---|
| `middleware.ts` | Centralized security headers (HSTS, CSP with nonce, `X-Frame-Options: DENY`, etc.) and `/admin` auth gate (404, not 403, when unauthorized) |
| `instrumentation.ts` | Sentry init for both Node.js and Edge runtimes, with `beforeSend` PII scrubber |
| `lib/auth.ts` | NextAuth configuration: Google provider, `ADMIN_ALLOWLIST` email enforcement, 24-hour JWT sessions, no refresh on activity |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth handler endpoint |
| `lib/security/logger.ts` | Pino wrapper with auto-redaction of `phone`/`email`/`address`/`name`/`token`/`secret`/etc. fields, plus `maskEmail`/`maskPhone` helpers |
| `lib/security/rate-limit.ts` | Upstash-backed named limiters (`contact-form-hour`, `contact-form-day`, `admin-login`, `admin-action`, `webhook-source`, `public-api`) with `checkLimit()`, `extractIp()`, and `rateLimitHeaders()` |
| `lib/security/zod.ts` | Shared validation schemas: `phoneSchema` (E.164 transform), `emailSchema`, `zipSchema`, `freeTextSchema` (2000-char cap + HTML strip), `shortTextSchema`, `nameSchema`, `honeypotSchema`, plus `fieldErrorsFromZod()` helper |
| `lib/webhooks/idempotency.ts` | Upstash-backed event-ID dedup (`checkAndMarkProcessed`), 24-hour TTL, namespaced by source (`stripe` / `twilio` / `make` / `internal`) |
| `lib/webhooks/verify.ts` | `constantTimeEqual`, `verifySharedSecret`, `hmacSha256Hex`, `verifyHmacSha256` |
| `eslint.config.mjs` | Flat-config ESLint setup using `eslint-config-next` 16 |
| `.secretlintrc.json` | Secretlint config (recommended preset) |
| `.husky/pre-commit` | Runs `npx lint-staged` (which fans out to secretlint + eslint --fix) |
| `progress/00-audit.md` | Phase 0 audit + Stage 0 checklist |
| `progress/01-security-foundations.md` | This document |

### Modified files

- `.gitignore` — added `*.pem`, `*.key`, `credentials*`, `service-account*`, plus `.vercel`
- `package.json` — new scripts (`secret-scan`), `lint-staged` config, dep bumps
- `.env.example` — full env var reference covering Stage 1–8
- `next.config.js` — added `turbopack.root` to silence the multi-lockfile warning
- `vercel.json` — removed the header block (now authoritative in `middleware.ts`)
- `components/Header.tsx` — added one `eslint-disable-next-line` for the new `react-hooks/set-state-in-effect` rule against the menu-close-on-route-change pattern (a legitimate effect use; rule is overly conservative)

### Behavior changes (visible to users)

**None.** The contact form, marketing pages, and dev-mode toggle all behave exactly as before. The only response-level change is that every page now includes stricter security headers — invisible to humans, scored by Mozilla Observatory and the like.

### Behavior changes (invisible to users)

- All paths in the matcher (everything except `/api/auth/*`, `/_next/static/*`, `/_next/image/*`, `favicon.ico`, `robots.txt`, `sitemap.xml`) now receive a CSP header with a per-request nonce
- `/admin/*` paths return 404 if the requester is not authenticated and on the `ADMIN_ALLOWLIST` (no `/admin` pages exist yet; this is just the gate ready for Stage 5)

---

## Verification performed

| Check | Result |
|---|---|
| `npm audit` | 0 high, 0 critical, 7 moderate (all transitive dev deps; documented as deferred) |
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npm run build` | Clean (one deprecation warning: `middleware` → `proxy` in Next 16; handled as a follow-up before Stage 5) |
| `npm run secret-scan` | Clean baseline (no secrets in any tracked file) |
| Manual secretlint test: synthetic Stripe sk_test key | Rejected as expected |

---

## Manual checklist for Mitch — please confirm before Stage 2 begins

These are out-of-band items that can't be enforced in code. Tick when done.

- [ ] **2FA enabled on every third-party account.** Hardware key or Authenticator app preferred over SMS:
  - [ ] Google Workspace (`admin@forgehandyman.com`)
  - [ ] Vercel
  - [ ] Cloudflare
  - [ ] Upstash
  - [ ] Sentry
  - [ ] Namecheap (domain control is high-value — phishing attacks here can redirect email AND break SSL)
  - [ ] GitHub (or wherever this repo lives)
  - [ ] Stripe — when account is created in Stage 3
  - [ ] Twilio — when account is created in Stage 4
- [ ] **Paste these env vars into Vercel** (values from the accounts you already created):
  - [ ] `UPSTASH_REDIS_REST_URL` (not sensitive)
  - [ ] `UPSTASH_REDIS_REST_TOKEN` (sensitive)
  - [ ] `SENTRY_DSN` (not sensitive — embedded in client JS)
  - [ ] `SENTRY_ORG` (not sensitive)
  - [ ] `SENTRY_PROJECT` (not sensitive)
  - [ ] `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (not sensitive — must include the `NEXT_PUBLIC_` prefix to reach the browser)
  - [ ] `TURNSTILE_SECRET_KEY` (sensitive)
- [ ] **Set a calendar reminder** for 2027-05-22 to start the annual secret-rotation drill.

Once those env vars are in Vercel, deploying this commit will activate:
- Pino logging (anywhere the code calls `logger.info`, etc.)
- Rate limiting (when the contact form gets its Stage 2 rewrite)
- Sentry capture (errors from anywhere)
- CSP enforcement on every response
- NextAuth admin login at `/api/auth/signin` (the `/admin` UI itself doesn't exist until Stage 5)

---

## Deferred / explicit non-goals for Stage 1

- **`middleware.ts` → `proxy.ts` rename.** Next 16 deprecated the `middleware` filename in favor of `proxy.ts` with an exported `proxy` function. The deprecation is a warning, not an error; current file works. We'll rename before Stage 5 (admin dashboard) so the auth gate ships under the new convention.
- **Stage 2 contact-form rewrite.** Stage 1 ships the primitives but does not yet wire them into `app/api/contact/route.ts`. The contact form continues to use its ad-hoc validation + broken in-memory rate limit until Stage 2.
- **Source-map upload to Sentry.** Stage 1 emits Sentry events but doesn't upload source maps at build time (would need `SENTRY_AUTH_TOKEN`). Stack traces in Sentry will be against minified code until we wire this up — fine for now since we're not yet getting real production errors.
- **`@types/node@22`** bump. We're still on `@types/node@20`. Node 22+ types may be needed when we adopt newer runtime features. Not urgent.
- **`gaxios` moderate CVE** (transitive via `googleapis`). Pending upstream patch. Not exploitable in our usage.
- **Brace-expansion moderate CVE** (transitive via TypeScript ESLint). DoS via crafted regex; our deps don't expose user input to brace-expansion. Will resolve on next dep update.

---

## Things to watch in Stage 2

- The CSP currently allows `'unsafe-inline'` for `style-src` (necessary for Tailwind's inline styles and Next.js's hydration). When we add Turnstile to the contact form, the widget's iframe and script will be allowed by the existing `https://challenges.cloudflare.com` entries — confirm in the Network tab that the widget loads.
- Pino's `pino-pretty` transport only loads in development and only in the Node runtime — Edge runtime doesn't support transports. Confirm no Pino errors appear in Vercel's Edge function logs.
- The `getToken` call in `middleware.ts` reads the NextAuth JWT from cookies. When Stage 5 adds the admin UI, the redirect from `/admin/*` → `/admin/login` (via NextAuth's `pages.signIn`) won't fire because middleware short-circuits to 404. That's the intentional "we don't acknowledge the admin route exists" behavior from the build plan. Stage 5 will add the `/admin/login` page that the signin URL points to.
