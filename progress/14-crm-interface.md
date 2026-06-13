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

## B2 — write integrity (next)

Postgres-gated money-path fixes — see the design spec's B2 section: markComplete
stops being a second completer (webhook stays authoritative), a pre-charge
`payments` guard row (+ a partial unique index migration), the human-path-only
status guard with escape edges, and the `isSameLocalDay` TZ fix. Should land
after the production cutover so its "trustworthy money paths" actually apply.
