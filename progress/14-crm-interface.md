# Stage 14 — CRM Interface (Phase B)

Branch: `stage/14-crm-interface`. Design + critique decisions:
`docs/stage-14-crm-interface-design.md` (v2). Built **postgres-first** on the
live Supabase project (`forge-handyman`, us-east-1) — decision: cutover-first.

---

## B1 — read surfaces (2026-06-13)

Turns `/admin` from a job list into a CRM: customer profiles, a per-job
activity timeline, and the activity-vocabulary foundation. **Postgres-only**;
sheet mode keeps today's basic admin and the new surfaces show an honest
"available once you're on Postgres" notice (`crmEnabled()`).

### What shipped
- **Customers** — `/admin/customers` (searchable by name/email/phone, sortable)
  and `/admin/customers/[id]` (keyed on the stable `customers.id` UUID, never
  email — survives anonymization). Profile shows contact, editable **standing
  notes** (`customers.notes`), a **Properties** section (group jobs by
  normalized address — landlords have one email, many properties), the job
  list, **"Deposits collected"** (honest; true LTV waits for B2's `payments`),
  and the activity timeline.
- **Activity timeline** on every job + customer — `ActivityTimeline` renders
  the `activities` feed with per-action icons, actor labels, relative time, and
  the **`claude` actor styled distinctly** (the Phase E hook). `AddNoteForm`
  appends a timeline note (`note.added`).
- **Activity foundation** — `lib/data/activity-actions.ts` (closed action set +
  actor types: `admin:<email>` / `stripe-webhook` / `telegram:david` /
  `claude` / `system`). `AuditEntry` gains `jobId`, plumbed through the
  webhook/payment/admin callers so the timeline associates on
  `activities.job_id`, not the overloaded `target`.
- **Data layer** (`lib/data/pg/{customers,activities-read}.ts`, dispatched in
  `lib/data/index.ts`): `listCustomers`, `getCustomerById`, `getCustomerStats`,
  `updateCustomerNotes`, `listActivitiesForJob`, `addJobNote`, `crmEnabled`.
  Reads off a `customer_summary` SQL view (real `GROUP BY`, not an in-memory
  scan); all-strings boundary discipline preserved.

### Design review (pre-commit)
4-lens adversarial review (correctness / activity-plumbing regressions /
security-auth / spec-UX), each finding independently verified — 3 confirmed,
0 false positives, all fixed:
- **major:** `customer_summary.property_count` diverged from the in-memory
  `normalizeAddress` (counted blank addresses, didn't collapse internal
  whitespace) → a same-page contradiction between the header stat and the
  Properties section. Fixed the view (`regexp_replace` + `filter`), applied as
  migration `20260613190000`, live-verified (5 jobs → 2 properties).
- **minor:** note actions accepted unbounded text → capped both at 2000
  (freeTextSchema convention).
- **minor:** `getCustomerById` aggregates by `customer_id` but anonymization
  redacts by email → added a read-side guard that blanks job PII whenever the
  customer is anonymized, so the profile can never out-render a deletion.

### Verification
| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 105 passing (7 files) |
| `npm run build` | clean — `/admin/customers` + `[id]` registered |
| Live-Postgres integration | seed customer+job+note via the real data layer → read back correct, string-boundary clean, cleaned up ✓ |
| `property_count` view fix | live-verified ✓ |

---

## B2 — write integrity (2026-06-14)

Postgres-gated money-path fixes. Sheet mode keeps the pre-B2 behavior unchanged;
none of this protects production until the cutover.

### What shipped
- **Double-charge guard.** A `payments` row is claimed BEFORE the Stripe call
  via the `claim_charge_attempt` RPC (returns `setof payments` → `[]` on
  conflict) against a partial unique index on `(job_id, purpose) where status in
  ('pending','succeeded','requires_action')`. Stripe idempotency keys expire at
  24h then re-charge — this row is the *durable* guard. A failed attempt drops
  out of the index, freeing a deliberate retry.
- **markComplete reworked.** Postgres path: claim → charge → record → write
  Complete (optimistic, so a job never strands charged-but-open) — the
  `payment_intent.succeeded` webhook is an idempotent backstop that re-confirms
  Complete and reconciles the payments row. 3DS (`requires_action`) charges
  can't complete synchronously; their row is held in the gate until the webhook
  resolves them.
- **Payments ledger.** The webhook records deposits / balance charges / refunds
  (best-effort, postgres-only, can never fail the webhook) — sets up true LTV.
- **Status-machine guard** (`lib/jobs/status-machine.ts`): the admin dropdown
  can no longer hand-set `Complete` (that would skip the balance charge);
  webhook-driven transitions bypass the guard; every terminal state has escape
  edges so nothing wedges. The dropdown shows only allowed targets.
- **Eastern-time Today/Tomorrow** (`isSameLocalDay`) — was UTC, rolled over at
  ~8pm ET.
- **Pipeline** surfaces Payment Failed / Cancelled / Refunded instead of
  dropping them.

### Design review (pre-commit, money-path)
4-lens adversarial review (double-charge / webhook-coordination / status-guard /
correctness), each finding independently verified — and the live integration
test caught a separate bug the unit tests missed:
- **(live test) double-charge trap:** the claim RPC returned an all-null row on
  conflict (not an empty result), so the code read it as "won the gate." Fixed
  (`setof` return + an id check). Verified: 2nd claim blocked, failed frees,
  succeeded holds.
- **(review blocker) 3DS gate leak:** a `requires_action` outcome dropped the
  row out of the gate index → a post-24h double-charge + an orphaned row. Fixed
  by including `requires_action` in the index / `findLiveAttempt` /
  `reconcileAttempt`. **Live-verified**: a 3DS row now holds the gate and the
  webhook still terminalizes it.
- 4 more confirmed (collected-but-not-Complete stranding → optimistic Complete;
  unguarded success write → best-effort; a `Partial Refund → Complete` edge →
  removed) — all fixed.

### Verification
typecheck / lint / build clean; **127 tests**; two live-Postgres integration
checks passed (the double-charge gate + the 3DS gate-hold + webhook reconcile).
