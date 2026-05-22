# Stage 2 — Sheet Schema Migration + Contact Form Hardening

Date: 2026-05-22
Branch: `stage/02-contact-form` (depends on Stage 1)

This document records what shipped in Stage 2 and what Mitch still needs to do manually to make the contact form fully functional in production.

---

## What shipped

### Code

| File | What it does |
|---|---|
| `lib/sheet/repo.ts` | Typed abstraction over Google Sheets. Defines `SHEET_HEADERS` (19 columns A–S), the `ContactRow` interface, and `appendContactRow` / `readHeaderRow` / `writeHeaderRow` / `backupCurrentSheet` / `getSheetAuth`. |
| `lib/security/turnstile.ts` | Server-side Cloudflare Turnstile token verification. Posts to `siteverify`, returns `{success, errorCodes}`. **Fails closed** when `TURNSTILE_SECRET_KEY` is missing in production; bypasses verification with a warning in development. |
| `scripts/setup-sheet.ts` | Idempotent migration script. Reads the current header row → if it matches the canonical schema, no-op; otherwise duplicates `Sheet1` into a `backup-{timestamp}` tab, then writes the canonical 19-column header. Run with `npm run setup-sheet` (Mitch's task once the sheet exists). |
| `app/api/contact/route.ts` | Full rewrite using Stage 1 primitives. New flow: honeypot drop → Zod validation → 5/hr + 20/day rate limit → Turnstile verify → geocoding gate → dev-mode short-circuit → Gmail (blocking, returns 502 on fail) → Calendar + Sheet in parallel via `Promise.allSettled` (non-blocking, Sentry-instrumented). |
| `components/ContactForm.tsx` | Adds invisible honeypot field, Cloudflare Turnstile widget (auto-renders when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set; gracefully omits otherwise), and UTM source capture from URL query params. Preserves the existing visual design and field UX. |
| `lib/google.ts` | Sheet append removed (now lives in `lib/sheet/repo.ts`). Gmail + Calendar helpers stay here unchanged. |
| `docs/sheet-schema.md` | Canonical contract for the 19-column sheet schema — every column's name, type, source, and downstream consumer. |
| `progress/02-contact-form.md` | This document. |

### Dependencies

- New dev: `tsx` (lets us run TypeScript scripts directly via `npx tsx scripts/setup-sheet.ts`)

No new runtime deps. Stage 2 uses what Stage 1 already installed (Zod, Pino, Sentry, Upstash, libphonenumber).

### Behavior changes the customer sees

| Change | Behavior |
|---|---|
| Honeypot field added | Invisible to humans. Bots that fill it get a 200 OK with no actual submission (silent drop). |
| Turnstile widget | Renders as a small Cloudflare badge above the submit button (when the site key env var is set). Most legitimate users never see a puzzle — it runs an invisible check. |
| Stricter validation | Phone numbers normalize to E.164 (`+18285551234`) before storage. Email lowercased. Descriptions trimmed to 2000 chars with HTML tags stripped. Date validated to `YYYY-MM-DD` format. |
| Better error messages | 422 with field-level errors when validation fails. 429 with `Retry-After` header when rate-limited. 403 if Turnstile fails. |
| UTM capture | If the user lands on the contact page with `?utm_source=...` in the URL, that value is captured (max 120 chars) and saved to column S of the sheet. |

### Behavior changes Mitch sees

- The master sheet (once created) gets 19 columns instead of 10 — see `docs/sheet-schema.md` for the full contract.
- Every failed Calendar or Sheet write fires a Sentry event with a `route:contact-form` tag and the specific step (`gmail-send`, `calendar-create`, `sheet-append`).
- Pino logger emits a structured `contact-form: submission accepted` event for every successful submission, with the email and phone redacted (`m***@gmail.com`, `***1234`).

---

## Manual checklist for Mitch — needed before Stage 2 actually works in production

The code is shipped, but the contact form still runs in dev mode (`NEXT_PUBLIC_DEV_MODE=true`) because no real Google credentials exist yet. To go live with the new form, Mitch needs to do the following:

### Step 1 — Create the master Google Sheet (~5 min)

1. Open Google Drive while signed in as `admin@forgehandyman.com`
2. **New → Google Sheets → Blank spreadsheet**
3. Rename the file to `Forge Handyman — Master Sheet`
4. Rename the default tab from `Sheet1` to `Sheet1` (it's already that — don't change it; the code looks for this exact name)
5. Copy the spreadsheet ID from the URL: `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
6. Paste that ID into Vercel as `GOOGLE_SHEET_ID` (not sensitive, all envs)

### Step 2 — Create the service account in Google Cloud (~10 min)

In your existing `forge-handyman` project at https://console.cloud.google.com:

1. **IAM & Admin → Service Accounts → Create Service Account**
2. Service account name: `forge-handyman-api`
3. Service account ID: auto-fills as `forge-handyman-api`
4. Description: `Used by the Next.js app to send Gmail, create Calendar events, and write to the master Sheet`
5. **Create and Continue** → skip the "Grant access" step (we use domain-wide delegation, not project IAM) → **Done**
6. Back on the service accounts list, click the new account → **Keys** tab → **Add Key → Create new key → JSON → Create**
7. A JSON file downloads. **DO NOT commit this file anywhere.** Keep it open in a temporary text editor — you'll paste two values into Vercel from it, then delete the file.
8. From the JSON, extract:
   - `client_email` → Vercel env `GOOGLE_SERVICE_ACCOUNT_EMAIL` (not sensitive, all envs)
   - `client_id` → save this number; you need it in step 4 below
   - `private_key` → Vercel env `GOOGLE_PRIVATE_KEY` (**sensitive**, Prod + Preview). When pasting, keep the `\n` escapes as-is; the code handles unescaping them.
9. **Delete the downloaded JSON file** from your machine once both values are in Vercel.

### Step 3 — Enable domain-wide delegation on the service account (~2 min)

Still in Google Cloud Console:

1. Open the service account you just created → **Details** tab
2. Toggle **"Enable Google Workspace Domain-wide Delegation"** ON
3. Product name for OAuth consent: leave as default
4. Save

### Step 4 — Authorize the service account in Workspace Admin (~3 min)

At https://admin.google.com (signed in as `admin@forgehandyman.com`):

1. **Security → Access and data control → API controls**
2. Under "Domain wide delegation," click **Manage Domain Wide Delegation**
3. **Add new**
4. Client ID: the `client_id` number from the service account JSON (step 2 above)
5. OAuth scopes (comma-separated, exact spelling):
   ```
   https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/spreadsheets
   ```
6. **Authorize**

### Step 5 — Set the remaining Vercel env vars

In Vercel → forge-handyman project → Settings → Environment Variables:

| Variable | Sensitive | Value |
|---|---|---|
| `GOOGLE_CALENDAR_ID` | No | `admin@forgehandyman.com` (or whatever email's calendar should hold the tentative booking events) |
| `BUSINESS_EMAIL` | No | `admin@forgehandyman.com` (or wherever the form notifications should send) |
| `GOOGLE_GEOCODING_API_KEY` | Yes | Your Google Geocoding API key. Get this from Google Cloud Console → APIs & Services → Credentials → Create Credentials → API Key. **Restrict the key** to the Geocoding API only. |

### Step 6 — Pull env vars locally and run the setup script (~2 min)

From your terminal at the repo root:

```bash
# Pull env vars from Vercel to a local .env.local (gitignored).
vercel env pull .env.local

# Run the setup script — writes the 19-column header row to the sheet.
npm run setup-sheet
```

You should see:
```
Reading current header row…
Found 0 columns in current header.
Writing canonical header row…
✓ Header row updated.
✓ Verified header row matches canonical schema.
```

### Step 7 — Flip dev mode off

In Vercel env vars, change `NEXT_PUBLIC_DEV_MODE` from `true` → `false`. Redeploy.

### Step 8 — Smoke test

Submit a real test entry through the contact form on production:
- Confirm the Gmail notification arrives
- Confirm a Calendar event was created at the requested date
- Confirm a new row appears in the master sheet
- Confirm the sheet has 19 columns and the new row has all relevant fields populated

If anything fails, Sentry will have captured the exception with full context. Check the Sentry dashboard.

---

## Verification performed during development

| Check | Result |
|---|---|
| `npm audit` | 0 high, 0 critical, 7 moderate (unchanged from Stage 1) |
| `npm run typecheck` | Clean |
| `npm run lint` | Clean |
| `npm run build` | Clean (same Next 16 middleware-deprecation warning as Stage 1) |

End-to-end live testing depends on Mitch completing steps 1–8 above.

---

## Deferred / explicit non-goals for Stage 2

- **The `hours_to_first_touch` formula** (column R). Code writes the column as empty. `docs/sheet-schema.md` provides the optional `ARRAYFORMULA` Mitch can paste into cell R2 if he wants the metric computed automatically. Skipped from auto-write because the API doesn't have a clean way to write a self-referential row formula at append time.
- **MX-lookup email validation.** The plan called for an MX-record check to reject obviously-fake emails like `asdf@asdf.asdf`. Skipped because it adds an unreliable third-party dependency and noticeable latency, and Zod's email format check + Turnstile catches the realistic bot patterns. Re-evaluate after we see a month of real submissions.
- **"Bypass rate limit with valid Turnstile token."** The plan suggested this. Skipped because it complicates the limiter logic without a clear benefit — Managed-mode Turnstile is invisible enough that the rate limit hitting before a real customer can submit 5 times is exceedingly rare. If we ever see legitimate users hitting the limit, we'll add the bypass.
- **Captcha only after first submission from IP.** Same reasoning — Managed Turnstile is silent for most users. Always-on is simpler and equally non-intrusive.

---

## Things to watch in Stage 3

- **Stripe webhook idempotency.** Stage 1 already shipped `lib/webhooks/idempotency.ts`. Stage 3 will exercise it for the first time — confirm the Upstash idempotency keys land correctly under the `idemp:stripe:*` namespace.
- **CSP allowances.** The Stage 1 middleware already allows `https://js.stripe.com` and `https://hooks.stripe.com` in script-src and frame-src. When we add the Stripe Payment Element or other widgets, confirm in the Network tab that nothing is blocked.
- **Sentry source map upload.** Stage 1 deferred this. By the time Stripe payment errors are flowing through Sentry, having readable stack traces will matter. Wire up `SENTRY_AUTH_TOKEN` and add the source-map upload step to the build script.
