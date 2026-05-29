# Stage 7 — Monitoring + Observability

Date: 2026-05-25
Branch: `stage/07-monitoring`

The "find out a bug exists *before* a customer hits it" stage. Three deliverables: a real health check, automated daily backup, and documented Sentry alert rules + uptime monitoring setup.

---

## What shipped (in code)

### `/api/health` — real liveness check

Hit `https://forgehandyman.com/api/health` and the endpoint returns:

```json
{
  "status": "ok",
  "timestamp": "2026-05-25T22:30:12.000Z",
  "checks": [
    { "name": "env-vars",       "status": "ok", "latencyMs": 1 },
    { "name": "google-sheets",  "status": "ok", "latencyMs": 142 },
    { "name": "stripe",         "status": "ok", "latencyMs": 89  },
    { "name": "upstash-redis",  "status": "ok", "latencyMs": 24  }
  ]
}
```

Returns HTTP **200** when all critical checks pass, **503** when any fail. Checks:

| Check | What it verifies | Action if it fails |
|---|---|---|
| `env-vars` | Required Vercel env vars are set (Google service account, Sheet ID, NextAuth secret, etc.) | Deployment is broken — someone removed an env var |
| `google-sheets` | Sheets API reachable; uses a read-only metadata call (no row data fetched) | Workspace DWD broken, service account suspended, or Google outage |
| `stripe` | Stripe API reachable; uses `balance.retrieve()` which always exists | Stripe key rotated/revoked, or Stripe outage |
| `upstash-redis` | Redis reachable; `PING` command | Upstash credentials wrong, or Upstash outage |

5-second timeout per check. Cached for 30 seconds (so UptimeRobot pinging every minute doesn't hammer downstream APIs).

### Daily sheet backup (Vercel cron)

`vercel.json` now has:

```json
"crons": [
  { "path": "/api/cron/backup-sheet", "schedule": "0 7 * * *" }
]
```

Translates to: every day at **7am UTC** (~2-3am Eastern, depending on DST). Vercel invokes the endpoint with an `Authorization: Bearer {CRON_SECRET}` header. Endpoint verifies the secret, exports **every visible tab** in the master sheet as CSV (so Sheet1 + Audit + any backup-* tabs you've accumulated), and emails them as separate attachments to `BUSINESS_EMAIL`.

Email looks like:

> **Subject:** Forge Sheet Backup — 2026-05-25
>
> **Body:**
> Daily Forge Sheet backup — 2026-05-25
>
> Total rows across 2 tabs: 23
>
> Per-tab row counts:
>   Sheet1: 18 rows
>   Audit: 5 rows
>
> Each tab is attached as its own CSV file. Files are RFC 4180 encoded.
>
> Drop these into a backup folder somewhere safe...
>
> **Attachments:**
> - `2026-05-25-Sheet1.csv`
> - `2026-05-25-Audit.csv`

If anything fails, the cron logs to Sentry tagged `route:cron-backup-sheet` so you find out about the broken backup the next morning instead of when you need it.

### CSV export + Gmail attachment helpers

- `lib/sheet/export.ts` — `exportAllTabsCsv()` exports every non-hidden tab as a CSV string. RFC 4180 quote escaping (commas, newlines, double quotes inside cells handled correctly).
- `lib/email/attachment.ts` — `sendEmailWithAttachments()` builds a multipart MIME message with the body + one or more file attachments. Uses the same service-account-impersonates-admin auth pattern as the rest of the email helpers.

---

## What Mitch needs to do — manual setup

Three things, ~20 minutes total.

### Step 1 — Add `CRON_SECRET` to Vercel (~2 min)

The cron endpoint refuses to run without this secret to prevent random hits from being able to trigger a daily backup spam.

1. Generate a random secret. In Terminal:
   ```bash
   openssl rand -hex 32
   ```
2. Copy the output (long hex string)
3. Vercel → forge-handyman → Settings → Environment Variables → **Add New**:
   - Name: `CRON_SECRET`
   - Value: paste the hex string
   - **Sensitive: yes**
   - Scope: Production + Preview
4. Redeploy production (Deployments → `…` on latest → Redeploy). Vercel needs this present at deploy time to wire it into the cron invocation.

Once redeployed, Vercel handles the rest — the daily cron fires at 7am UTC, sends the `Authorization: Bearer ${CRON_SECRET}` header automatically.

### Step 2 — Set up UptimeRobot to ping `/api/health` (~5 min)

External uptime monitoring catches outages even if your Vercel function logs are unavailable.

1. Go to https://uptimerobot.com → Sign up (free tier is enough — 50 monitors @ 5-min intervals)
2. Verify your email
3. **+ New Monitor**:
   - **Monitor Type**: HTTPS
   - **Friendly Name**: `Forge Handyman — /api/health`
   - **URL (or IP)**: `https://forgehandyman.com/api/health`
   - **Monitoring Interval**: 5 minutes
   - **Monitor Timeout**: 30 seconds
   - **Custom HTTP Statuses**: 200 (only treat 200 as up; 503 = down)
   - **Alert Contacts**: add your email + (optionally) SMS via Twilio integration if you set that up later
4. Save

UptimeRobot now pings the health endpoint every 5 minutes from multiple regions. If any 2 consecutive pings fail, you get an email immediately. Most outages get caught within 5-10 minutes of starting.

**Optional alert tuning** (avoid false positives):
- Configure "Send notification when down for at least: 5 minutes" so a single bad ping doesn't wake you up
- Enable maintenance windows for any scheduled downtime (none expected for Forge, but nice to know about)

### Step 3 — Configure Sentry alert rules (~10 min)

Code is already tagging errors appropriately (Stripe webhook failures, contact-form Gmail send failures, admin server-action errors, etc.). Now create alert rules so the right ones page you immediately.

1. Go to https://sentry.io → Forge Handyman project → **Alerts** (left sidebar) → **Create Alert Rule**
2. Set up **three** alert rules:

#### Rule A — Payment errors (immediate)

- **Alert name**: `Payment errors — immediate`
- **Environment**: production
- **When**: An event is captured
- **If**: tag `route` equals one of `[stripe-webhook, admin]` AND tag `step` contains `payment` OR `charge` OR `refund`
- **Then**: Send notification → your email (and Slack if you've connected it)
- **Frequency**: Every minute (so you get notified on the first occurrence)

#### Rule B — Webhook signature failures spike

- **Alert name**: `Webhook signature failures spike`
- **Environment**: production
- **When**: Number of events seen
- **If**: message contains `signature verification failed` OR tag `route` equals `stripe-webhook` AND event level is `warning`
- **In**: 10 minutes
- **Trigger when**: count is more than `3`
- **Then**: Send notification → your email

Why this matters: a single signature failure is a fluke (network blip, key rotation in progress). Multiple in a short window means someone is probing your webhook endpoint with fake signatures — could be reconnaissance.

#### Rule C — Admin auth-failure spike

- **Alert name**: `Admin auth-failure spike`
- **Environment**: production
- **When**: Number of events seen
- **If**: message contains `Not authorized` AND tag `route` equals `admin`
- **In**: 10 minutes
- **Trigger when**: count is more than `5`
- **Then**: Send notification → your email

Why this matters: someone hitting `/admin/*` with bad credentials repeatedly = credential stuffing attempt. Worth knowing about even though our 404-not-403 design makes it harder for them to figure out anything.

#### Optional: source map upload

Currently Sentry stacktraces show minified production JS. Readable stacktraces require uploading source maps at build time. To enable:

1. Sentry → Settings → Account → API → Auth Tokens → Create new token with `project:write` + `release:write` scopes
2. Add to Vercel as `SENTRY_AUTH_TOKEN` (sensitive)
3. Next deploy will upload source maps; future errors will show readable line numbers

Not blocking for now — defer if you want. Stage 1's `progress/01-security-foundations.md` had this as a deferred item.

---

## Verification performed during development

| Check | Result |
|---|---|
| `npm audit` | unchanged (0 high, 0 critical) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — new routes `/api/health`, `/api/cron/backup-sheet` registered, cron entry in vercel.json |

---

## Live smoke test (after merge + deploy + setup steps)

1. **Health endpoint**: visit `https://forgehandyman.com/api/health` in a browser. JSON response with `status: "ok"` and 4 checks all `"ok"`.
2. **UptimeRobot**: dashboard shows the monitor as green and pinged within the last 5 minutes.
3. **Cron**: in Vercel → Deployments → Cron → you should see `/api/cron/backup-sheet` listed with the next-fire time. After it fires, check Gmail for the backup email (with CSV attachments). Or trigger it manually from the cron page.
4. **Sentry alerts**: trigger a deliberate failure to verify alerts fire — e.g., temporarily set `STRIPE_SECRET_KEY_TEST` to garbage and submit a Stripe webhook event from the Stripe CLI. The webhook signature failure should produce a Sentry event tagged appropriately.

---

## Deferred / explicit non-goals for Stage 7

- **Custom dashboard / status page** — `/api/health` is JSON-only. UptimeRobot has a public status page if you want one. Not building one ourselves.
- **Log forwarding to Better Stack / Logtail** — Vercel's built-in log retention is enough for the first few months. Add this if/when log volume exceeds Vercel's retention window (~1 hour on Hobby).
- **APM / performance monitoring** — Sentry has some Performance Monitoring features but the free tier doesn't include them. Skip unless we have a perf problem.
- **Cost monitoring** — set this up directly in Vercel + Stripe + Upstash + Sentry dashboards (each has billing alerts). Documented in `progress/00-audit.md`'s ongoing-operational section.
- **Customer-visible status page** — at our volume the email-to-Mitch model is enough.

---

## Tying back to the original build plan

The original Stage 7 (Phase 9 in the plan) called for daily 2am ET backup to a private GCS bucket with 30/12/7 retention. We replaced that with Gmail attachments because (1) the GCS bucket added an account/credential to manage and (2) you already have a Gmail inbox that retains everything. Retention is now however long you keep Gmail (effectively forever) and you don't pay for storage. Trade-off: harder to programmatically restore from Gmail, but the manual restore flow ("copy CSV contents back into the sheet tab") is straightforward.

The plan's monthly restore drill is still worth doing — pick a random backup from the last week, paste its CSV into a test sheet, verify row counts match. Add a calendar reminder for the 1st of every month.
