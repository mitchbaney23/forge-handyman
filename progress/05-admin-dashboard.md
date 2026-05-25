# Stage 5a — Admin Dashboard (Auth + Overview + Job Detail)

Date: 2026-05-23
Branch: `stage/05a-admin-dashboard`

This is part 1 of Stage 5. It gives Mitch a real working admin UI he can sign into from any device — list of jobs by section, click into a specific job, flip status, mark complete (which triggers the Stripe balance auto-charge from Stage 3 if there's a balance owed and a saved card).

Part 2 (Stage 5b, not in this PR) will add `/admin/quotes` (send Payment Links) and `/admin/pipeline`. Part 3 (Stage 5c) adds photos and seasonal nudges.

---

## What shipped

### Pages

| Path | Behavior |
|---|---|
| `/signin` | Client-side sign-in page outside the `/admin` 404 gate. Single "Continue with Google" button → NextAuth → redirect to `/admin` on success. |
| `/admin` | Overview. 5 sections: Needs triage (status=New), Today, Tomorrow (Booked / In Progress filtered by preferred_date), Open quotes (Quoted / Pending Follow-Up), Recently completed (last 7 days). Stat bar at top shows counts. Each job is a tappable card linking to detail. |
| `/admin/jobs/[id]` | Job detail. Customer info (with tel/mailto links), request fields, description, payment state (deposit paid, balance owed, saved card y/n), timing (first touch, complete date, job ID), and the actions panel. |

### Components / helpers

| File | Purpose |
|---|---|
| `app/admin/layout.tsx` | Server-component layout. Reads session via `getServerSession`, shows signed-in email + Sign out button in the top bar. |
| `app/admin/SignOutButton.tsx` | Client component wrapping `signOut()` from NextAuth. |
| `app/signin/SignInButton.tsx` | Client component wrapping `signIn('google', { callbackUrl: '/admin' })`. |
| `app/admin/jobs/[id]/JobActions.tsx` | Client component with the status dropdown, "Record first touch" button, and "Mark Complete" button with confirmation modal. |
| `app/admin/jobs/[id]/actions.ts` | Server actions: `updateJobStatus`, `recordFirstTouch`, `markComplete`. Each verifies admin session + applies the `admin-action` rate limit (5/min/admin) + writes to the Audit tab + revalidates the pages. |
| `components/admin/StatusBadge.tsx` | Color-coded pill for the job status. |
| `components/admin/JobCard.tsx` | Tappable card used on the overview and any list view. |
| `lib/sheet/queries.ts` | `listJobs()` reads the whole sheet and parses rows. `groupJobsForOverview()` segments rows into the 5 dashboard buckets. |

### Auth wiring

- `lib/auth.ts` updated: `pages.signIn` and `pages.error` now point at `/signin` (was `/admin/login`, which the middleware 404'd because `/admin/*` is gated).
- The Stage 1 middleware already 404s any `/admin/*` path unless the requester has a NextAuth session whose email is in `ADMIN_ALLOWLIST`. Nothing to change there.
- Server actions defense-in-depth: every action re-verifies the session inside the action handler (don't trust that the route is gated; trust nothing).

### Behavior — what the customer sees

**Nothing.** Stage 5a only touches `/admin/*` and `/signin`. The marketing site, contact form, and existing API endpoints are untouched.

### Behavior — what Mitch sees

- Visit `forgehandyman.com/signin` → sign in with `admin@forgehandyman.com` → land on `/admin`.
- Overview shows up to 5 sections of jobs pulled live from the Google Sheet. Counts in the top stat bar.
- Tap a job → detail page with customer info, all request fields, and an Actions panel.
- Change status from the dropdown → server action fires → row in the sheet updates → audit log entry appended → page revalidates with the new status.
- Mark Complete with a balance owed AND a saved card → confirmation modal → server action calls `chargeBalance` from `lib/stripe/charges.ts` → if succeeded, status flips to `Complete`, `balance_owed_cents` set to `0`, complete date stamped.
- Mark Complete with a balance owed but NO saved card (Stripe webhook never ran because no Stripe account yet) → status flips, but you'll need to collect the balance manually. UI tells you so.

---

## Verification performed during development

| Check | Result |
|---|---|
| `npm audit` | unchanged (0 high, 0 critical) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — new routes `/admin`, `/admin/jobs/[id]`, `/signin` registered |

---

## Live test plan (Mitch to run after merge + deploy)

1. **Sign-in flow.** Visit `forgehandyman.com/signin` → click "Continue with Google" → sign in as `admin@forgehandyman.com` → land on `/admin`. Confirm signed-in email shows in top right.
2. **404 protection.** Open a private window (not signed in) → visit `forgehandyman.com/admin` → should get a 404 page, not a redirect. Visit `/admin/jobs/abc-fake-id` → also 404.
3. **Read the overview.** Should show your past test submissions in the appropriate buckets. Anything with status="New" lands in "Needs triage." Stat counts should match.
4. **Click a job.** Tap any job card → detail page renders with all 24 columns' worth of data displayed in panels.
5. **Status change.** From the status dropdown, change a test job from `New` → `Quoted`. Page revalidates, sheet row updates, Audit tab gets a row with `action=job.status_changed`.
6. **First touch.** Click "Record first touch" on a test job. Sheet's `first_touch_sent_at` populates with current ISO timestamp. Button disappears (the page rerenders without it once recorded).
7. **Mark Complete (no balance).** On a test job with no balance owed, click Mark Complete → confirm → status flips to Complete, complete_date stamped. No Stripe charge (no balance to charge).
8. **Sign out.** Click Sign out in top right → land on home page → visit `/admin` → confirm 404.

---

## Deferred / explicit non-goals for Stage 5a

- **Sending Payment Links from the admin UI.** Stage 5b adds `/admin/quotes` with a form to send a Payment Link to a customer. Stage 3 already built `createQuotePaymentLink()`; we'll wire it to the UI next.
- **Job photos.** Stage 5c adds `/admin/jobs/[id]/photos` once we know how David is going to send pictures (Twilio MMS in Stage 4 is the leading candidate).
- **Seasonal nudges UI.** Stage 5c. Depends on Stage 6 follow-up automation backend.
- **Pipeline view.** Stage 5b. The overview gives Mitch what he needs day-to-day; the pipeline view is the "are any jobs stalled?" sanity check.
- **3DS authentication flow.** When `chargeBalance` returns `requires_action`, the current admin UI surfaces an error message telling Mitch to handle it manually in the Stripe dashboard. Plan calls for auto-generating a hosted authentication link and emailing the customer. Punted to Stage 5c or later.
- **Refund UI.** `refundCharge()` exists in `lib/stripe/refunds.ts`. UI for it lives in a future stage when there's a real refund need.

---

## Things to watch in Stage 5b

- The chargeBalance integration is wired but cannot fire today because Mitch hasn't set up the Stripe account yet (no `STRIPE_SECRET_KEY_TEST`). Marking jobs complete without a balance owed works fine; balance-owed jobs need the Stripe setup to flow end-to-end.
- The sheet read on every `/admin` page load is a full-table fetch. At Forge's scale (tens to low hundreds of jobs) this is fine. If we ever hit thousands of rows, we'll want to paginate or add a query index.
- The middleware's 404-not-403 design means there's no built-in "redirect to sign-in" behavior. Mitch must know to visit `/signin` to authenticate. Bookmark it.
