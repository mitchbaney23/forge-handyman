# Stage 8a — Launch Readiness (PR 10: Launch safety + legal)

Date: 2026-05-29
Branch: `stage/10-launch-safety`

Part 1 of the launch-readiness phase. Everything here is unblocked by the LLC — it gets the site ready to flip live so the day NC approves the LLC, going live is a fast finish. The LLC-gated work (Stripe live keys, Twilio) is captured in `docs/go-live-runbook.md` (PR 11).

---

## What shipped

### Kill switches (were documented, now wired)

`CONTACT_FORM_DISABLED` and `AUTOMATIONS_DISABLED` were defined in `.env.example` + `progress/00-audit.md` with stated behavior, but **no code read them**. Now:

- **`CONTACT_FORM_DISABLED=true`** → `POST /api/contact` returns 503 at the very top of the handler with a friendly maintenance message (`maintenance: true` flag in the JSON). `components/ContactForm.tsx` renders that as a distinct maintenance notice, not a generic error. `app/api/upload-photo/route.ts` also short-circuits (no uploads while the form is down). The marketing site stays fully up — only the booking form is gated.
- **`AUTOMATIONS_DISABLED=true`** → already correctly checked by `/api/cron/send-review-requests` (and the seasonal-nudge send path is admin-driven). Confirmed the daily `backup-sheet` cron does **not** check it — backups must always run regardless of the customer-facing automation switch.

### Legal pages

- **`app/privacy/page.tsx`** (`/privacy`) — plain-English: what we collect, why, who we share with (Google, Stripe, Cloudflare, Vercel/Upstash/Sentry, Twilio-when-live), retention schedule, and the customer's choices (unsubscribe, STOP, request deletion).
- **`app/terms/page.tsx`** (`/terms`) — service area, free estimates + scope, deposit-on-booking / balance-on-completion payment terms, scheduling & cancellation, workmanship, NC-law liability cap, photo usage.
- **`components/LegalLayout.tsx`** — shared layout for both (navy header + readable content column styled via Tailwind arbitrary-descendant selectors, no typography plugin needed).
- **`components/Footer.tsx`** — Privacy + Terms links added to the bottom bar on every page.

### CAN-SPAM compliance

Added the business mailing address to the footers of both automated emails (`lib/email/review-request.ts` HTML + text, `app/admin/seasonal-nudges/actions.ts` HTML), alongside the existing unsubscribe links. CAN-SPAM legally requires a valid physical postal address in commercial email.

### Constants

`lib/constants.ts` — added `BUSINESS.mailingAddress` as the single source for the address used in footers + legal pages.

---

## ⚠️ Required before go-live: replace the placeholder mailing address

`BUSINESS.mailingAddress` is currently a **placeholder** (`PO Box 0000, Garner, NC 27529`). CAN-SPAM requires a *real* physical postal address. **Mitch must replace this** in `lib/constants.ts` with Forge's actual PO box or business address before the review-request / seasonal-nudge emails go to real customers. It's one line, clearly commented in the file.

---

## Deploy note

Local `main` was behind the PR #9 squash-merge (the follow-up automation), and production was still serving commit `0c33fac` (pre-PR-#9) because the PR #9 merge-deploy failed on a transient `CRON_SECRET` whitespace error. `CRON_SECRET` is clean now. When **this** PR (10) merges, the resulting deploy builds current `main` HEAD — which includes PR #9's automation as an ancestor — so the review cron, `/unsubscribe`, and `/admin/seasonal-nudges` all go live with this merge. (Or redeploy from the Vercel dashboard sooner if desired.)

---

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — `/privacy` + `/terms` registered as static |
| Kill-switch logic | `CONTACT_FORM_DISABLED` returns 503 + `maintenance` flag before any work; upload-photo mirrors it |

**Manual test after deploy:**
- Set `CONTACT_FORM_DISABLED=true` on a preview → submit the form → maintenance notice shows, no 500
- `/privacy` and `/terms` render and are linked from the footer
- Trigger a review-request / nudge email → footer shows the mailing address + unsubscribe link

---

## Still to come (PR 11)

- Admin data-request anonymization action (`/admin/data-requests`)
- `docs/data-retention.md`, `docs/incident-response.md`, `docs/go-live-runbook.md`
