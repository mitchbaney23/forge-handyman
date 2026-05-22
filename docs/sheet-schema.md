# Master Sheet Schema

This is the canonical contract for the Forge Handyman master Google Sheet. It is the source of truth for the contact form, the admin dashboard (Stage 5), the follow-up automation (Stage 6), and every other code path that touches a customer record.

If the columns ever change, update this file, update [`lib/sheet/repo.ts`](../lib/sheet/repo.ts), and run `npx tsx scripts/setup-sheet.ts` against the live sheet to apply the change.

## Layout

- Sheet name: `Sheet1` (do not rename — code looks for this exact tab name)
- Header row: row 1
- Data rows: row 2 onward
- Total columns: **19** (A–S)
- Sheet ID lives in Vercel as `GOOGLE_SHEET_ID`

## Columns

| Letter | Header | Type | Source | Read by | Notes |
|---|---|---|---|---|---|
| A | `submitted_at` | ISO 8601 timestamp (UTC) | Contact form (server-side `new Date().toISOString()`) | Admin dashboard, follow-up automation | Always server-generated. Never trust client. |
| B | `name` | string | Contact form | Admin dashboard, Gmail notification | Trimmed, max 120 chars |
| C | `phone` | E.164 string (`+15555555555`) | Contact form (libphonenumber-js normalize) | Admin dashboard, Twilio SMS | Always E.164 for Twilio compatibility |
| D | `email` | lowercased email | Contact form | Admin dashboard, review-request automation | Trimmed and lowercased on write |
| E | `address` | string | Contact form | Admin dashboard, Gmail notification | Trimmed, max 240 chars |
| F | `service_type` | string (enum-ish) | Contact form `<select>` | Admin dashboard, content automation | Values from `SERVICE_OPTIONS` in `lib/constants.ts` |
| G | `preferred_date` | `YYYY-MM-DD` string | Contact form `<input type="date">` | Admin dashboard, Calendar event | Validated to be a real date string |
| H | `description` | string | Contact form (HTML stripped, normalized whitespace) | Admin dashboard, Gmail notification | Max 2000 chars |
| I | `referral_source` | string | Contact form `<select>` | Admin dashboard, marketing analytics | Defaults to `Not specified` |
| J | `status` | enum: `New`, `Quoted`, `Booked`, `In Progress`, `Complete`, `Cancelled` | Contact form writes `New`; admin dashboard mutates | Admin dashboard, billing flow, follow-up automation | Drives the job's state-machine |
| K | `complete_date` | ISO timestamp | Admin dashboard (Stage 5, "Mark Complete" button) | Follow-up automation | Triggers the 4-hour review-request countdown |
| L | `review_sent_at` | ISO timestamp | Stage 6 automation | Follow-up automation | Set when the review-request email is sent |
| M | `review_send_count` | integer string | Stage 6 automation | Follow-up automation | Number of review request attempts (cap at 2) |
| N | `review_received` | `true`/`false`/empty | Manual / Stage 6 automation | Follow-up automation | Stops the reminder loop |
| O | `seasonal_nudge_last_sent` | ISO timestamp | Stage 6 automation | Follow-up automation | Used to enforce 180-day cooldown between nudges |
| P | `opt_out` | `true`/`false`/empty | Twilio STOP webhook, unsubscribe link, manual admin action | All outbound automation | Hard-stop on any outbound to this email or phone |
| Q | `first_touch_sent_at` | ISO timestamp | Admin dashboard (when Mitch sends the first reply) | Speed-to-lead analytics | Optional — not blocking |
| R | `hours_to_first_touch` | number (decimal hours) | Optional sheet formula (see below) | Speed-to-lead analytics | Empty unless the formula is added manually |
| S | `utm_source` | string | Contact form (captured from URL query params on page load) | Marketing analytics | Empty if user came in directly |

## Optional formula for column R (`hours_to_first_touch`)

If you want this metric computed automatically, drop the following formula into cell `R2` of the sheet — it back-fills the entire column:

```
=ARRAYFORMULA(IF(ROW(Q2:Q)>COUNTA(A2:A)+1,"",IF(Q2:Q="","",(Q2:Q-A2:A)*24)))
```

The contact form writes an empty string to column R for each new row; this formula overrides empties with the computed value. If you don't want the metric, leave R empty — nothing downstream depends on it yet.

## Adding new columns later

1. Add the new column name to `SHEET_HEADERS` in [`lib/sheet/repo.ts`](../lib/sheet/repo.ts) (in the position where you want it to live)
2. Add the field to the `ContactRow` interface in the same file
3. Re-run `npx tsx scripts/setup-sheet.ts` against the live sheet — the script backs up the current tab and writes the new header row
4. Update this doc

The header order in `SHEET_HEADERS` is authoritative. The script writes whatever order is in that constant.

## What writes to what

| Source | Columns written |
|---|---|
| Contact form (`POST /api/contact`) | A, B, C, D, E, F, G, H, I, J (status=`New`), S (utm_source) |
| Setup script (`scripts/setup-sheet.ts`) | Headers in row 1 |
| Admin dashboard (Stage 5) | J (status changes), K (complete_date), Q (first_touch_sent_at) |
| Stage 6 follow-up automation | L, M, N, O |
| Twilio inbound STOP webhook (Stage 4) | P (opt_out) |
| Unsubscribe page (Stage 6) | P (opt_out) |
