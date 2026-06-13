# Stage 14 — CRM Interface (Phase B): Design Spec v2

Date: 2026-06-13
Status: v2 — revised after a four-lens adversarial critique (29 findings).
Branch: `stage/14-crm-interface`. Decision: **cutover-first** — Phase B is built
**postgres-first**; sheet mode keeps today's basic admin and the new CRM
surfaces render an honest "available on Postgres" state. This drops the
throwaway sheet-parity work the critique flagged.

Phase B turns `/admin` into the CRM Mitch runs the business from: customer
profiles, a per-job activity timeline, an upgraded Today view, and (B2) the
money-path integrity fixes. Builds on the Phase A data layer + the live
Supabase project (`forge-handyman`, us-east-1).

## Sub-PR split

- **B1 — read surfaces (this PR).** Customer list + profiles, job activity
  timeline, upgraded Today, activity-vocabulary foundation. Pure additive
  reads + one append (notes). No money paths touched.
- **B2 — write integrity (next PR, postgres-gated).** Detailed at the bottom;
  built after B1 lands.

---

## Key decisions from the critique (the deltas from v1)

1. **Customer identity / profile URL = `customers.id` (UUID), never email.**
   Email breaks on anonymization (redaction rewrites it to `redacted:<uuid>`)
   and would collapse all redacted customers into one profile. Routes are
   `/admin/customers/[id]` where id = `customers.id`.
2. **Activity vocabulary is foundational.** A versioned module
   `lib/data/activity-actions.ts` defines the closed action set + actor types
   (`admin:<email>` | `stripe-webhook` | `telegram:david` | `claude` |
   `system`). `AuditEntry` gains an explicit `jobId?: string` passed at write
   time — the timeline associates on `activities.job_id`, NOT on the
   overloaded `target` (which is sometimes a Stripe id or masked email). This
   makes Phase E's AI-as-actor an additive layer, not a redesign.
3. **New CRM reads are postgres-only.** Sheet mode returns empty + the pages
   show "Customer profiles & timeline are available once you're on Postgres."
   No sheet-mode `readAuditRows`, no email-grouping parity — all the complexity
   the critique flagged is removed by the cutover-first decision.
4. **pg aggregates are real SQL, not in-memory reduces.** `listCustomers` /
   `getCustomerStats` read from a `customer_summary` Postgres VIEW
   (`GROUP BY customer_id`), not a `listJobs()` scan.
5. **Properties view.** A customer's profile groups their jobs by normalized
   address (`trim`/`lowercase`/collapse-whitespace) into a "Properties (N)"
   section — landlords have one email, many addresses. Derived in-memory from
   the customer's jobs (small N); no schema change.
6. **Honest lifetime value.** `balance_owed_cents` is zeroed on completion, so
   collected revenue isn't recoverable from the jobs columns pre-B2. B1 shows
   **"Deposits collected"** = `sum(deposit_paid_cents)` over the customer's
   jobs, labeled exactly that. True LTV arrives with B2's `payments` table.
7. **Phone is a search key.** The customer list searches name / email / phone.
8. **Notes have two distinct homes, two affordances.** Standing context (gate
   code, "prefers texts") → editable `customers.notes` rendered as a pinned
   header block. Event notes → append-only `activities` (`note.added`) in the
   timeline. Two visibly different UI controls, never one ambiguous form.

---

## B1 — data layer (`@/lib/data`, postgres impls; sheet = empty + flag)

New migration `supabase/migrations/<ts>_customer_summary.sql`:
```sql
create view customer_summary as
select c.id, c.name, c.phone, c.email, c.notes, c.anonymized_at, c.created_at,
       count(j.id)                          as job_count,
       max(j.submitted_at)                  as last_job_at,
       min(j.submitted_at)                  as first_job_at,
       coalesce(sum(j.deposit_paid_cents),0) as deposits_collected_cents,
       count(distinct lower(btrim(j.address))) as property_count
from customers c left join jobs j on j.customer_id = c.id
group by c.id;
```

New functions (all return the all-strings discipline — money as cent-strings,
dates ISO-normalized, no null/undefined across the boundary):

| Function | Postgres | Sheet |
|---|---|---|
| `listCustomers()` | select from `customer_summary`, paginated, ordered by `last_job_at desc` | `[]` |
| `getCustomerById(id)` | one `customer_summary` row + that customer's jobs (via `customer_id`) | `null` |
| `listActivitiesForJob(jobId)` | `activities where job_id = $1 order by at desc`, paginated | `[]` |
| `getCustomerStats()` | counts (total customers, active, etc.) from the view | zeros |
| `addJobNote(jobId, actor, text)` | insert `activities` row, `action='note.added'`, `job_id=jobId` | `appendAuditRow` (best-effort) |
| `updateCustomerNotes(id, notes)` | update `customers.notes` | no-op |
| `crmEnabled()` | `getBackend() === 'postgres'` | — |

Return types defined as part of the surface: `CustomerSummary`
(id, name, phone, email, notes, jobCount, lastJobAt, depositsCollectedCents as
STRING, propertyCount, anonymized), `CustomerDetail` (summary + `jobs: JobRow[]`
+ derived `properties: { address, jobCount, lastJobAt }[]`), `Activity`
(id, at, actor, action, target, before, after, notes, jobId, data). All run
through the same coercion the Phase A mappers use.

## B1 — activity foundation

- `lib/data/activity-actions.ts` — `ACTIONS` (closed set incl. `note.added`,
  `nudge.sent`/`nudge.skipped` distinct, all existing dotted-nouns), `ACTORS`
  helpers (`adminActor(email)`, `CLAUDE`, `SYSTEM`, `STRIPE_WEBHOOK`,
  `telegramActor`).
- `AuditEntry` gains `jobId?: string`. `pg/audit.ts` sets `job_id` from
  `entry.jobId ?? (isUuid(target) ? target : null)`. Existing `appendAuditRow`
  callers that know their jobId pass it (webhook-handlers, the admin job/quote
  actions, the contact route) so timeline association is reliable. Sheet
  `appendAuditRow` is unchanged (no job_id column; target carries jobId as
  today) — sheet timeline is not built, so no read-back dependency.

## B1 — pages & components

```
/admin/customers       CustomerTable (search name/email/phone, sortable)
/admin/customers/[id]   CustomerHeader (contact + editable standing notes),
                        PropertiesSection, job list, ActivityTimeline
/admin/jobs/[id]        + ActivityTimeline section + AddNoteForm  (new)
/admin                  Today dashboard: existing groups + customer count
```
- Components: `CustomerTable`, `CustomerHeader`, `PropertiesSection`,
  `ActivityTimeline` (per-action icon + actor label + relative time; `claude`
  actor styled distinctly), `AddNoteForm` (timeline note), `EditNotesForm`
  (standing notes). Extend `StatusBadge` color map to the orphaned statuses.
- Nav: add **Customers** to `app/admin/layout.tsx`.
- In sheet mode, `/admin/customers` and the timeline render a one-line
  "available once you're on Postgres" notice (via `crmEnabled()`), not an error.

## B1 — tests

vitest with a mocked supabase client: customer-summary mapping (cent-strings,
date normalization, no null crosses boundary), properties grouping
(address normalization, multi-property customer), activity vocab (actor
helpers, action set), `listActivitiesForJob` ordering, `addJobNote` writes
`job_id` + `note.added`. Plus the existing suite stays green.

## B1 — verification

typecheck / lint / test / build, integration-checked against the live Supabase
project (seed a customer+job+activity, read it back through the data layer),
then the multi-agent review before commit.

---

## B2 — write integrity (next PR, postgres-gated; recorded now so B1 leaves room)

- **markComplete stops being a second completer.** The Stripe webhook
  (`payment_intent.succeeded`, `purpose=balance-charge`) already writes
  `status=Complete, balance=0` asynchronously — it stays authoritative.
  markComplete's job becomes: (1) look up any live `payments` attempt for the
  job → short-circuit if found; (2) INSERT a `payments` row `status='pending'`
  with a unique idempotency key **before** the Stripe call (its own committed
  txn — this is the double-charge guard, since Stripe keys expire at 24h then
  re-charge); (3) call `chargeBalance`; (4) UPDATE the row succeeded/failed.
  It does NOT write `status=Complete` itself.
- **Schema follow-up migration:** partial UNIQUE index on `payments`
  (`(job_id, kind) where status in ('pending','succeeded')`) so the pre-charge
  insert is the concurrency gate (`ON CONFLICT DO NOTHING`).
- **Status guard governs only the human `updateJobStatus` path** — webhook
  status writes bypass it intentionally (Stripe is the source of truth for
  payment/refund states). The transition table includes escape edges from
  every terminal/error state (Payment Failed → Booked/In Progress/Cancelled;
  Refunded → Cancelled/Complete) so no job wedges.
- Fix `isSameLocalDay` to bucket on America/New_York, not UTC.
- Pipeline shows the orphaned statuses instead of dropping them.
- B2's money-path UI/logic is gated on `getBackend() === 'postgres'`; sheet
  mode keeps today's best-effort markComplete unchanged. **B2 should not
  protect-claim until the production cutover is done.**
