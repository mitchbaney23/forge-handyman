# Stage 6/8 — Follow-up Automation (review requests + seasonal nudges)

Date: 2026-05-29
Branch: `stage/08-follow-up-automation`

The "stay in front of past customers without being annoying" stage. Two follow-up flows:
1. **Review requests** — fully automated. Sent 4–72 hours after job completion.
2. **Seasonal nudges** — surfaced for admin review. You approve/edit/skip per customer.

Both flows are unsubscribe-aware via HMAC-signed one-click links.

---

## What shipped

### Review requests (fully automated)

- **`lib/email/review-request.ts`** — branded HTML+text email: "How did we do?", customer first name, service performed, city reference for SEO anchor, big "Leave a Google review →" CTA, unsubscribe footer
- **`/api/cron/send-review-requests`** — Vercel cron runs **every hour at :30**. Scans the sheet for rows matching:
  - `status === "Complete"`
  - `complete_date` between 4 hours and 72 hours ago
  - `review_sent_at` empty (only sends once per job)
  - `opt_out !== "true"`
  - Then sends the email, stamps `review_sent_at`, increments `review_send_count`
- Respects the `AUTOMATIONS_DISABLED=true` kill switch from Stage 8

The Google review link defaults to a Google search for "Forge Handyman Service Garner NC". For a direct Place URL, set `GOOGLE_REVIEW_URL` in Vercel (instructions in `.env.example`).

### Seasonal nudges (admin-reviewed)

- **`lib/automation/nudges.ts`** — `findNudgeCandidates()` returns customers whose:
  - Most recent completed job is 180+ days old
  - No seasonal nudge sent in the last 180 days
  - Not opted out
  - Grouped by email (one card per customer, regardless of prior job count)
  - Sorted by staleness (oldest customer last contacted first)
- **`lib/templates/seasonal/index.ts`** — per-service-category template copy. 8 specific category variants + a generic fallback. Templates are friendly, low-pressure, anchored to "what they hired us for last time."
- **`/admin/seasonal-nudges`** — admin page that lists candidates with a pre-filled subject + body for each. Three buttons per card:
  - **Send nudge** — sends the email, stamps `seasonal_nudge_last_sent` on all their rows, writes audit log
  - **Skip for 180 days** — stamps `seasonal_nudge_last_sent` without sending (so they don't reappear for 180 days), writes audit log
  - Subject and body are editable before send
- **Nav link** added to admin top bar: `Today / Pipeline / Nudges / Maintenance`

### Unsubscribe (CAN-SPAM compliance)

- **`lib/automation/unsubscribe.ts`** — HMAC-signed tokens, format `v1.{base64url-email}.{base64url-issued-at}.{base64url-hmac}`
  - `signUnsubscribeToken(email)` — embedded in every automated email's footer
  - `verifyUnsubscribeToken(token)` — constant-time signature check + 365-day expiry
  - `buildUnsubscribeUrl(email)` — full URL pointed at the apex domain (defends against Vercel preview URLs)
- **`/unsubscribe?token=...`** — public page (no auth required). Validates the token, sets `opt_out=true` on every row matching the email, shows a confirmation. Errors gracefully if the token is missing/tampered/expired.

### Cron schedule

`vercel.json` now has two cron entries:

| Path | Schedule | What |
|---|---|---|
| `/api/cron/backup-sheet` | `0 7 * * *` | Daily 7am UTC backup (Stage 7) |
| `/api/cron/send-review-requests` | `30 * * * *` | Hourly at :30 — scan + send |

Both verify the `Authorization: Bearer ${CRON_SECRET}` header before running.

---

## What Mitch needs to do

### Required for review requests to work (~3 min)

1. **Add `UNSUBSCRIBE_HMAC_SECRET` env var** to Vercel:
   ```bash
   openssl rand -base64 32
   ```
   Paste output → Vercel as `UNSUBSCRIBE_HMAC_SECRET` → **sensitive**, Production + Preview → redeploy.

2. **(Optional but recommended) Add `GOOGLE_REVIEW_URL`** for a direct-to-write-a-review CTA:
   - Open Google Maps, search for Forge Handyman
   - Click the listing → Share → "Embed a map" — grab the place URL from the iframe src
   - Or use https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID once you have the Place ID
   - Paste into Vercel as `GOOGLE_REVIEW_URL` — not sensitive, all envs

If you don't set `GOOGLE_REVIEW_URL`, the email's CTA links to a Google search for your business name in Garner. Still works, just one extra click for the customer.

### Required for seasonal nudges to work

Same `UNSUBSCRIBE_HMAC_SECRET` as above. That's it — the admin UI handles the rest.

---

## Smoke test plan

1. **Unsubscribe round-trip** — visit `/admin/seasonal-nudges`, find any candidate (or fall back to a manual test). Click **Send nudge**. Open the resulting email in your inbox, click the unsubscribe footer link. Confirm:
   - You land on the styled "You're unsubscribed" page
   - The sheet's `opt_out` column flips to `true` on every row matching your email
   - Audit tab gets a `seasonal_nudge.sent` + the unsubscribe event isn't logged but the row update is verifiable

2. **Review request cron** — pick a sheet row with `status=Complete` and `complete_date` 5 hours ago. Set `review_sent_at` to empty. Trigger the cron manually via Vercel dashboard (Deployments → Crons → "Run now"). Expect:
   - Email arrives at the customer's address
   - `review_sent_at` and `review_send_count` populate

3. **Opt-out respected** — set `opt_out=true` on a row, trigger the cron. Expect: no email sent, `review_sent_at` stays empty.

---

## Verification performed

| Check | Result |
|---|---|
| `npm audit` | unchanged |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — `/unsubscribe`, `/admin/seasonal-nudges`, `/api/cron/send-review-requests` registered |

---

## Deferred

- **Customer review templates by source** (Google vs Nextdoor vs Facebook). Today we always link Google. Multi-source could come later if Mitch wants.
- **A/B subject lines for the review email**. Out of scope; the current subject line is intentionally personal.
- **Bulk send for nudges**. Per-card review is intentional — Mitch should approve each one for now to maintain the "small business that pays attention" feel.
- **Review reminder retries**. The cron will skip rows where `review_sent_at` is set — no automatic second nudge. Mitch can manually clear `review_sent_at` if he wants a re-send.
