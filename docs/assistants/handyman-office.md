# Handyman office (Mom)

Moved here from the platform repo on 2026-09-23: Forge Handyman runs on this website, which is its CRM, and is not on the Bellows CRM platform. The Claude Team seats bought on 2026-09-18 are for the talent side (Kelli and John); Mom's seat is not scheduled yet, so this is ready for when it is.

## Purpose

Mom's front door to Forge Handyman. It shows her the board each morning, triages the operations@ inbox with drafted replies she sends herself, logs phone jobs, moves jobs along, and answers "what is going on with the Kims' job" without her opening anything. David decides dispatches on Telegram; money happens in the admin site.

## Accounts

- Claude Team seat: Mom's.
- Google: operations@forgehandyman.com (exists). Receives every site notification (`NOTIFICATION_EMAILS`) and a copy of inbound mail to admin@ (Workspace routing rule).
- Website: `MCP_KEYS` entry `mom:<token>`; `ADMIN_ALLOWLIST` includes operations@ so the admin site works on her phone.
- Telegram: `TELEGRAM_OPS_CHAT_ID`, FYI cards only.

## Connectors on the seat

| Connector | URL or app | Authenticates as |
|---|---|---|
| Handyman site | `https://forgehandyman.com/api/mcp` | bearer, the `mom` token |
| Gmail | Google connector | operations@forgehandyman.com |

## Project instructions (paste as written)

```
You are the office assistant for Forge Handyman, a family handyman business serving Garner, Clayton and South Raleigh, NC. You work for Mom, who runs the office. David does the work in the field. Mitch runs quotes, money and the website.

Where things live
- The website connector is the business: customers, jobs, appointments, notes and a snapshot. Jobs move New, Quoted, Pending Follow-Up, Booked, In Progress, Complete; Cancelled; and payment states that Stripe sets on its own.
- Her mail is the Gmail connector on operations@. Every booking, lead notification, receipt and daily digest lands there, and so does customer mail sent to admin@.
- David gets each new lead on Telegram with Approve, Decline and Sub out buttons. That is his decision to make, not yours and not Mom's.

How you work
- Plain language, short. Lead with what needs Mom today. Name the customer and the job.
- When Mom describes a phone call, log it right away as a customer and a job at New: name, phone, address, what the work is, how soon, who referred them. Read it back in two lines and say that David's card goes out when the job is dispatched from the admin site.
- Move jobs when she says so (Quoted, Pending Follow-Up, Booked, In Progress, Cancelled). If the site refuses a move, tell her why in its words.
- Add notes to jobs for anything worth remembering: a callback promised, a gate code, a change of scope.
- For customer mail, draft the reply in a warm, direct voice and hand it to Mom to send. Do not send.

What you never do
- Send an email or a text to a customer. Drafts only.
- Mark a job Complete, send a quote, charge a card or refund. Those happen in the admin site, and completing a job charges the balance.
- Guess. If the job does not say, say it does not say, and suggest who to ask.
```

## Scheduled task (Eastern time)

| Name | Cadence | Mirrors | Prompt |
|---|---|---|---|
| Morning board | Every day 07:00 | `speed-to-lead`, `inbox-manager` | "Good morning. From the website: today's booked jobs with time, address and customer; jobs in New with no dispatch decision yet and how long they have waited; quotes in Quoted or Pending Follow-Up older than 3 days; anything with a balance owed after Complete. From operations@ since yesterday: customer mail that needs a reply, each with a drafted reply for me to send; and the site's own notifications summarised in one line each. Under 250 words, most urgent first." |

The 06:30 site digest email arrives before this runs, so the routine can reference it.

## Phone-call script

On the phone, in the Claude app with this Project: "New job from a call. Sarah Kim, 919 555 0142, 412 Oak St in Garner. Two TVs mounted and a leaky kitchen faucet, wants it this week, referred by her neighbor Dave." Expect: customer and job at New with those fields, read back, and the reminder about David's card. Then: "Add a note that she prefers texts after 5." Then, later: "Move the Kim job to Quoted."

## Verification

- The intake script creates the customer and job; they appear on `forgehandyman.com/admin` with the AI chip on the timeline reading `claude:mom`.
- A test email to operations@ produces a drafted reply in the morning routine and no sent mail.
- Asking it to mark a job Complete returns the site's refusal, unchanged.
- The morning board names the same jobs the admin pipeline shows.

## Setup, in order

1. Vercel (Mitch): `MCP_KEYS` gains `mom:<token>` (`openssl rand -base64 32`, password manager); `ADMIN_ALLOWLIST` includes operations@forgehandyman.com; `NOTIFICATION_EMAILS=admin@forgehandyman.com,operations@forgehandyman.com` (already set as of 2026-09-23); `TELEGRAM_OPS_CHAT_ID` once she has messaged the dispatch bot and read her chat id back. Redeploy, then `/api/health` shows `mcp: ok`, `lead-routing` with both addresses, `telegram: ok`.
2. Google Workspace admin for forgehandyman.com (Mitch): Apps, Google Workspace, Gmail, Routing: a rule for inbound mail to admin@ that also delivers to operations@. A standing rule, so a human sets it. Test with a plain email from outside.
3. Her Claude seat: a custom connector for `https://forgehandyman.com/api/mcp` with her token (on a Team org the Owner adds it, with the token under Request headers as `authorization: Bearer <token>`; that value is org-wide, so name it `Forge Handyman (Mom)` and only she enables it), plus the Gmail connector on operations@.
4. A Project called Handyman office with the instructions above and the morning routine.
5. The admin site on her phone's home screen (`forgehandyman.com/admin`, Google sign-in with operations@), and the intake script once, on a real phone.
