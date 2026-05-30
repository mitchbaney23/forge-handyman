# Data Retention Policy

How long Forge Handyman keeps customer data, and how we honor deletion requests.

## Retention schedule

| Record type | Retention | Rationale |
|---|---|---|
| **Completed-job records** (status `Complete`, `Refunded`, `Partial Refund`) | **7 years** | Federal tax record-keeping requires keeping business transaction records ~7 years. |
| **Declined / expired leads** (status `New`, `Quoted`, `Cancelled` with no payment, older than 90 days) | **90 days**, then anonymize | No tax obligation; minimize PII we hold. |
| **Photos** (Google Drive `Forge Photos/{job_id}/`) | Same schedule as the parent job | Photos belong to the job they document. |
| **Audit log** (Audit tab) | Indefinite | Append-only security/accountability record; contains no raw customer PII (emails are masked). |
| **Daily CSV backups** (emailed to BUSINESS_EMAIL) | As long as the inbox retains them | Operational backup; same sensitivity as the sheet. |

## Deletion vs. anonymization

We **anonymize rather than delete** completed-job rows. Replacing PII (`name`, `phone`, `email`, `address`, `description`, `photo_urls`, `utm_source`) with `[REDACTED]` while keeping the row preserves the financial/job integrity needed for tax records, while removing the personal information.

For leads that never became jobs, full deletion is fine, but anonymization via the same tool is sufficient and simpler.

## Honoring a customer deletion request

1. Customer emails to request deletion (the privacy policy points them at `BUSINESS_EMAIL`).
2. Mitch signs into `/admin` → **Data** tab → enters the customer's email → confirms.
3. The action redacts PII on every matching sheet row and writes a `data.anonymized` entry to the Audit tab.
4. **Photos:** the anonymization clears the `photo_urls` cell but does **not** delete the Drive files. To fully remove photos, also delete the `Forge Photos/{job_id}/` folder(s) from Drive manually. (Future enhancement: wire Drive deletion into the action.)
5. **Stripe:** customer/payment records in Stripe are retained per Stripe's own policy and tax needs. To remove a Stripe customer's PII, delete the customer in the Stripe dashboard (this preserves the financial transaction record but removes contact details).

## Periodic cleanup (quarterly)

- Review leads older than 90 days that never converted → anonymize in a batch via the Data tab.
- Confirm the daily backup is arriving (check inbox for the most recent `Forge Sheet Backup` email).
- Spot-check that anonymized rows show `[REDACTED]` and that no un-redacted PII lingers past its retention window.

## What we never retain

- **Raw card numbers / CVC / bank details** — these never touch Forge systems. Stripe handles all card data (PCI SAQ-A scope). We only store Stripe customer/payment-method IDs (tokens), never the underlying card.
