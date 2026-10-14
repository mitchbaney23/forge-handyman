# Claude's door: `/api/mcp`

The website is the handyman business's system of record, and this route is how Claude works it: on a phone after a call, in Mom's morning routine, in Mitch's co-CEO Project. Why it is on the site rather than in a second CRM: `forge-platform/docs/decisions/2026-09-17-claude-as-entry-point.md`.

## What it is

A Model Context Protocol server (Streamable HTTP, `mcp-handler` on Vercel) at `https://forgehandyman.com/api/mcp`, protected by a bearer token per person. Tools are thin wrappers over the same data layer and mutation core the admin site uses (`lib/mcp/tools.ts`), so the status state machine, the shared input validation and the activity log apply exactly as they do for a human in `/admin`. Every change shows on the job timeline as `claude:<label>` with the AI chip.

| Tool | Does | Writes |
|---|---|---|
| `find_customer` | by email, phone or part of a name | no |
| `customer_history` | one customer with properties and every job | no |
| `list_jobs` | the board, filter by status, needsTriage or openQuotes | no |
| `get_job` | one job with its appointment and timeline | no |
| `today_schedule` | appointments for a day, Eastern | no |
| `log_phone_job` | customer plus a job at New (phone, text, referral). Does not dispatch David | yes |
| `move_job` | status move under the admin rules; Complete and payment states refused | yes |
| `add_note` | a timeline note | yes |
| `business_snapshot` | counts, triage, open quotes, balances, revenue this month, lead sources | no |
| `price_menu` | the flat-rate menu with add-on prices, the numbered bundles, the pricing rules | no |
| `preview_quote` | builds a quote for a job without sending: recipient, amounts, email text, the price picked at booking, the last quote sent, blockers and warnings | no |
| `send_quote` | Stripe Payment Link for the deposit, quote email to the customer, job to Quoted, balance owed recorded | yes, money |

`send_quote` is the one action here that reaches a customer. It runs the same core as the admin quote page (`lib/crm/quote.ts`, shared by both), so the link, the email, the status change and the `quote.sent` activity are identical whoever sends. Two guards on top of the admin site's: the `admin-money` limit of 5 a minute per person applies as well as the `mcp` limit, and jobs with a deposit already paid, or In Progress or later, are refused (a re-quote would flip a paid job back to Quoted); re-quote those from `/admin`. Self-scheduled jobs are Booked with nothing paid, so they can be quoted. The server instructions tell Claude to run `preview_quote`, read the amounts and recipient back, and get a yes before sending.

Deliberately absent: charge, refund, cancel appointment, anonymize, any other email. Those stay in `/admin`.

## Env (Vercel)

`MCP_KEYS=mitch:<token>,mom:<token>`. Mint each token with `openssl rand -base64 32`, put it in the password manager, mark the variable Sensitive, Production scope only. `/api/health` reports `mcp: ok, keys for: mitch, mom` (labels only). Unset means every request gets 401.

Each person also has a rate limit of 60 calls a minute (`lib/security/rate-limit.ts`, bucket `mcp`).

## Adding it to Claude

Who uses it and how their Claude is set up: `docs/assistants/handyman-office.md` (Mom). Mitch's co-CEO Project, which spans both businesses, is described in the platform repo (`mitchbaney23/forge-platform`, `docs/assistants/co-ceo.md`).


claude.ai, Settings, Connectors, Add custom connector: name "Forge Handyman", URL `https://forgehandyman.com/api/mcp`, authentication bearer token, paste the person's token. Then enable it in the Project that should use it. The same works in the Claude desktop and mobile apps once the connector is on the account.

## Trying it without Claude

```bash
curl -s -X POST https://forgehandyman.com/api/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -H 'Authorization: Bearer <token>' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Without the header the answer is 401 with a `WWW-Authenticate` challenge.

## Rotating and removing

Replace the token in the person's entry to rotate; delete the entry to remove them; redeploy. Nobody else's access changes.
