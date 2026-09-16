# Twenty sync: the site pushes every job into the family's CRM

The contract (field mapping, principles, what Twenty must never own) lives in the platform repo, `mitchbaney23/forge-platform`, at `businesses/forge-handyman/SYNC.md`. This page is the site-side operator note.

## What it does

After the site's own write succeeds, `lib/twenty/sync.ts` upserts the customer (matched by email) and the job (matched by `websiteJobId`, which is `jobs.id`) into the Twenty handyman workspace over its REST API. It runs from:

| Call site | Moment |
|---|---|
| `app/api/contact/route.ts`, booked branch | after the appointment is linked, as BOOKED with the slot |
| `app/api/contact/route.ts`, lead branch | after the row is written, as NEW (raises the triage task in Twenty) |
| `lib/crm/mutations.ts` `moveJobStatus` | after every admin pipeline move |
| `app/admin/quotes/[id]/actions.ts` `sendQuote` | job to QUOTED plus a SENT Quote record with the Stripe link |
| `app/admin/jobs/[id]/actions.ts` completion paths | COMPLETE with the completed date |
| `lib/stripe/webhook-handlers.ts` | Booked (and the quote to ACCEPTED), Complete, Payment Failed, Refunded, Partial Refund |
| `app/admin/data-requests/actions.ts` | redacts the mirrored person and jobs on a deletion request |

Every call is best-effort and never throws. A Twenty outage costs nothing but a Sentry event tagged `feature: twenty-sync`.

## Env (Vercel)

| Var | Value |
|---|---|
| `TWENTY_API_URL` | `https://bellowscrm.com/rest` |
| `TWENTY_API_KEY` | generated inside the handyman workspace, Settings, API keys. Sensitive, Production only. Keys are workspace scoped: a talent key writes to the wrong CRM, and `/api/health` reports it as a `twenty` failure |
| `TWENTY_SYNC_DISABLED` | `true` to switch the mirror off without removing the key |

Unset means off. `/api/health` shows `twenty` as `skipped` until the key is set, `ok` once the Jobs object answers.

## Backfill, once

After the workspace is stamped and before, or right after, the env goes live:

```bash
npx tsx scripts/backfill-twenty.ts
```

reads Supabase and prints create/update per record without writing. Then:

```bash
npx tsx scripts/backfill-twenty.ts --execute --limit 5
```

on a handful, check them in Twenty, then without `--limit`. Re-running creates no duplicates.

## Not built, on purpose

No write-back from Twenty to the site (phase 2 in the contract). Scheduling edits made in Twenty do not reach David's calendar; make them on the site.
