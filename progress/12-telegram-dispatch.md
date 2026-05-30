# Stage 12 — Telegram Job Dispatch to David

Date: 2026-05-29
Branch: `stage/12-telegram-dispatch`

The moment a valid in-area lead comes in, **David gets a Telegram message** with the job details and three tap-buttons — **✅ Approve / ❌ Decline / 🔁 Sub out**. His tap updates the sheet, edits his message to confirm, and **pings Mitch on Telegram**. Free, instant, no app to learn, and not blocked by the LLC the way Twilio SMS is.

---

## What shipped

### Outbound (lead → David)
- **`lib/telegram/client.ts`** — thin Bot API wrappers: `sendMessage`, `editMessageText`, `answerCallbackQuery`. Returns `null`/`false` gracefully if `TELEGRAM_BOT_TOKEN` is unset (so nothing throws in dev).
- **`lib/telegram/dispatch.ts`** — `dispatchJobToDavid(row)` builds the job card (name, address + Google Maps link, service, preferred date, phone + contact preference, photo count, returning-customer flag, the job description) and the 3-button inline keyboard, sends it to `TELEGRAM_DAVID_CHAT_ID`, and returns the `message_id`. Callback data uses short prefixes (`a:` / `d:` / `s:` + jobId) to stay under Telegram's 64-byte limit.
- **`app/api/contact/route.ts`** — best-effort dispatch step after the email/calendar/sheet writes. Runs only for in-area, non-dev submissions (already past both gates), never blocks the customer response, skipped when `DISPATCH_DISABLED=true` or the sheet append failed. Records `dispatch_status='Dispatched'` + `telegram_message_id` back to the row.

### Inbound (David taps → decision recorded)
- **`app/api/webhooks/telegram/route.ts`** — modeled on the Stripe webhook:
  1. Verifies the `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET` (constant-time) — **mandatory**, the route is public.
  2. Rate-limits (`telegram-webhook`, 60/min).
  3. Idempotency-dedupes on `update_id` (Telegram retries until it gets a 200).
  4. **Button tap** → confirms the sender is David, updates `dispatch_status` / `dispatch_decision` / `dispatch_decided_at`, edits David's message to strip the buttons + append his choice, sends him a toast, pings Mitch, writes an Audit row (`dispatch.approved` / `dispatch.declined` / `dispatch.needs_sub`).
  5. **Plain message from an unknown chat** → replies with that chat's ID (the zero-friction way to capture David's and Mitch's chat IDs during setup).
  6. Always returns 200 fast.

### Decision semantics
`dispatch_status` is a **separate** field from the customer/billing `status`. David's tap sets it to `Approved` / `Declined` / `Needs Sub`. Declines and sub-outs append "⚠️ Needs your attention" to Mitch's ping. Sub-out is flag-and-notify only in v1 (no subcontractor roster).

### Admin
- **`dispatchToDavid(jobId)`** server action (`app/admin/jobs/[id]/actions.ts`) for manual re-dispatch / resend if David misses one — same `requireAdmin → rateLimit → findRowByJobId → updateRowByJobId → appendAuditRow` pattern as the other admin actions.
- **"Re-dispatch to David"** button in `JobActions.tsx` + a **"Field dispatch"** panel on the job detail showing `dispatch_status`, David's call, and the decided-at time.

### Schema + primitives
- 4 new sheet columns: `dispatch_status`, `dispatch_decision`, `dispatch_decided_at`, `telegram_message_id`.
- `'telegram'` added to the `WebhookSource` union; `'telegram-webhook'` rate limiter added.

---

## Mitch's one-time setup (~15 min)

1. **Create the bot:** open Telegram, message **@BotFather** → `/newbot` → name it (e.g. "Forge Dispatch") → copy the **bot token**.
2. **Generate the webhook secret:** `openssl rand -hex 32`.
3. **Add to Vercel** (both **sensitive**, Production + Preview), then redeploy:
   - `TELEGRAM_BOT_TOKEN` = the bot token
   - `TELEGRAM_WEBHOOK_SECRET` = the hex secret
4. **Register the webhook** (one-time, run in a terminal):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://forgehandyman.com/api/webhooks/telegram&secret_token=<SECRET>"
   ```
   (Should return `{"ok":true,"result":true,"description":"Webhook was set"}`.)
5. **Capture chat IDs:** have **David** install Telegram, find your bot, and send it any message ("hi"). The bot replies with **his chat ID** — paste it into Vercel as `TELEGRAM_DAVID_CHAT_ID`. Do the same yourself → `TELEGRAM_MITCH_CHAT_ID`. (Not sensitive — just numbers.) Redeploy.
6. **Run the sheet migration:** `/admin` → **Maintenance** → **Run sheet migration** (adds the 4 new columns).

After that, the next in-area submission auto-dispatches to David.

---

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — `/api/webhooks/telegram` registered |

**Manual test after setup:**
1. Submit a test in-area lead → David's Telegram shows the job card + 3 buttons.
2. Tap **Approve** → message edits to "— Approved ✓", sheet `dispatch_status=Approved` + `dispatch_decided_at` set, Mitch gets a ping, Audit tab row `dispatch.approved`. Repeat for Decline / Sub out.
3. Security: `POST /api/webhooks/telegram` with no/bad secret-token header → 401. Replay the same `update_id` → no-op (idempotency).
4. `DISPATCH_DISABLED=true` → new leads don't dispatch (email/calendar/sheet still work).
5. Admin "Re-dispatch to David" resends and updates the Field-dispatch panel.

---

## Deferred / fast-follow

- **Inline photos in Telegram** (stream Drive files via `sendPhoto`) — v1 shows the count.
- **Subcontractor roster + routing** — v1 sub-out just flags + pings Mitch.
- **Firm appointment time at dispatch** — v1 shows the customer's preferred date; exact time confirmed by phone.
- **David field pings** ("running late" / "arrived") — natural next once the bot's in his hands.
