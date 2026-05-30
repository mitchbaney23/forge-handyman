# Incident Response Runbook

What to do when something breaks or a security event happens. Written to be usable from a phone at 2 AM.

## Who to call

- **Mitch Baney** (manager/owner) — primary. Cell on file.
- Hosting: Vercel status → https://www.vercel-status.com
- Payments: Stripe status → https://status.stripe.com
- Google Workspace status → https://www.google.com/appsstatus

## First question: is it the site, or a dependency?

Hit the health endpoint: **https://forgehandyman.com/api/health**

- `status: "ok"` → the app and its dependencies are up; the problem is elsewhere (DNS, a specific feature, a user error).
- `status: "fail"` → one of the checks names the broken dependency (`google-sheets`, `stripe`, `upstash-redis`, `env-vars`). Start there.
- Endpoint itself unreachable / 500 → the deploy is broken. Check Vercel → Deployments for a failed build; roll back to the last good deploy (Vercel → Deployments → previous Ready deploy → Promote).

## Common incidents

### "The contact form is broken / showing errors to customers"

1. **Disable it immediately** so customers see a friendly message instead of errors: set Vercel env var `CONTACT_FORM_DISABLED=true` (Production), then redeploy. The form now returns "We're updating our booking system — please call us at (phone)" and the marketing site stays up.
2. Diagnose: `vercel logs <latest-prod-url>` filtered for `contact-form`. Check Sentry for the exception.
3. Fix, deploy, then set `CONTACT_FORM_DISABLED` back to empty/false and redeploy.

### "Automated emails are going out wrong / spamming"

1. Set `AUTOMATIONS_DISABLED=true` (Production) + redeploy. This stops the review-request cron and blocks seasonal-nudge sends. (Daily backups keep running — they're not gated.)
2. Diagnose and fix, then re-enable.

### Suspected admin account compromise

1. **Revoke access:** remove the suspect email from `ADMIN_ALLOWLIST` in Vercel + redeploy. Existing sessions are rejected on their next request (the allowlist is re-checked server-side every action).
2. Rotate `NEXTAUTH_SECRET` (`openssl rand -base64 32`) → this invalidates ALL admin sessions, forcing re-login.
3. Review the Audit tab for any admin actions you don't recognize.

### Stripe webhook secret compromised / needs rotation (no downtime)

1. In Stripe → Developers → Webhooks, add a **second** endpoint pointing at the same `/api/webhooks/stripe` URL with a new signing secret.
2. Add the new secret to Vercel as `STRIPE_WEBHOOK_SECRET_LIVE` (or `_TEST`), redeploy. Now both secrets work because... actually our handler reads one secret — so: set the new secret, redeploy, confirm events still verify, THEN delete the old endpoint in Stripe. Run both Stripe endpoints for ~1 hour to catch in-flight retries before deleting the old one.

### Data breach (PII exposed)

1. Contain: rotate any leaked credential immediately (see credential list in `progress/00-audit.md` → rotation policy).
2. Assess scope: what data, how many customers, which were NC residents.
3. Notify per law:
   - Affected customers — within 72 hours (most state breach laws).
   - **NC Attorney General** — required for breaches affecting **1,000+ NC residents** (NC Identity Theft Protection Act). File at https://ncdoj.gov.
   - Stripe — if payment data is involved, Stripe will guide required steps.
4. Document the timeline in writing.

### Restore the sheet from backup

1. Find the most recent `Forge Sheet Backup` email in `BUSINESS_EMAIL`'s inbox (sent daily ~2–3 AM ET).
2. Download the `Sheet1` CSV attachment.
3. Open the master Google Sheet → select all of `Sheet1` → delete → File → Import → Upload the CSV → "Replace current sheet."
4. Verify row count matches the backup email's stated count.
5. The `setup-sheet` admin page (`/admin/setup-sheet`) can re-verify the header schema afterward.

## Kill-switch quick reference

| Env var (Vercel, then redeploy) | Effect |
|---|---|
| `CONTACT_FORM_DISABLED=true` | Contact form + photo upload return 503 maintenance message; marketing site stays up |
| `AUTOMATIONS_DISABLED=true` | Review-request cron + seasonal-nudge sends skip; backups still run |
| Remove email from `ADMIN_ALLOWLIST` | That admin loses access on next request |
