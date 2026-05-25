# Stage 6a — Contact Form Expansion

Date: 2026-05-25
Branch: `stage/06a-contact-form-expansion`

Applies the relevant pieces of Amendment 1 plus the additional fields Mitch asked for. Photo upload is deferred to Stage 6b.

---

## What shipped

### Service category taxonomy (Amendment §21.1)

Replaced the old 8-option `SERVICE_OPTIONS` list with the locked 10-category vocabulary. Internal codes + customer labels:

| Code | Label |
|---|---|
| `mounting` | Mounting & assembly (TVs, shelves, furniture) |
| `plumbing` | Plumbing repair or fixture install |
| `electrical` | Electrical repair or fixture install |
| `drywall_paint` | Drywall, painting, or trim |
| `doors_windows` | Doors, windows, or hardware |
| `carpentry` | Carpentry, deck, or fence work |
| `exterior` | Outdoor or exterior work |
| `maintenance` | General repair or maintenance |
| `multiple` | Multiple things (a punch-list) — auto-derived when 2+ categories selected |
| `other` | Not sure / something else — derived from "I'm not sure" checkbox |

The 8 specific categories appear as toggle pills on the form. The customer either checks 1+ pills OR checks an "I'm not sure" box. Server derives the final `service_type` value:
- 0 selected + "not sure" off → validation error
- 1 selected → `service_type` = that code
- 2+ selected → `service_type` = `multiple`, all selected codes saved to `service_categories` column
- "not sure" on → `service_type` = `other`, ignore any checkbox state

### New form fields (Mitch's asks)

| Field | UI | Required | Notes |
|---|---|---|---|
| Property type | Single-select dropdown | Yes | Residential / Rental / Commercial / HOA / Other |
| Services (multi-select) | Pill toggles | Yes (or "not sure") | 8 category options |
| Urgency | Single-select | Yes | ASAP / 2 weeks / Month / Flexible |
| Best contact time | Single-select | No (defaults Any) | Any / Morning / Afternoon / Evening |
| Best contact method | Single-select | No (defaults Any) | Any / Phone / Text / Email |
| **Address autocomplete** | Google Places Autocomplete attached to address input | (uses existing required validation) | Pulls verified US addresses; biased toward Wake/Johnston counties |

### Sheet schema expansion (24 → 32 columns)

Added Y–AF:

| Column | Header |
|---|---|
| Y | `service_categories` (CSV of category codes) |
| Z | `property_type` |
| AA | `urgency` |
| AB | `best_contact_time` |
| AC | `best_contact_method` |
| AD | `photo_urls` (reserved for Stage 6b) |
| AE | `is_returning_customer` (`true` or empty) |
| AF | `prior_job_count` (integer string) |

Also fixed an off-by-one in `SHEET_COLUMN_LETTER` generation — old code used `String.fromCharCode(65 + index)` which broke at index 26 (`Z` + 1 = `[`). Now uses a proper base-26 conversion so we can grow past Z to AA, AB, etc. without the column letters breaking.

The setup-sheet script handles the migration idempotently — it'll auto-backup the existing tab and rewrite headers.

### Notification email redesign (Amendment §21.3)

`lib/google.ts` `buildEmailHtml` / `buildEmailText`:
- **Subject line**: `New lead: {firstName} — {service label} in {city}`. Example: `New lead: Sarah — Drywall, painting, or trim in Garner`.
- **Duplicate-lead prefix**: when the same email submitted in the last 24 hours, the subject is prefixed `[2nd]`, `[3rd]`, etc. Detected by counting prior leads with the same email + submitted-at within 24h.
- **Prominent "Build Quote →" button**: amber, 44px tall, centered, above the fold. Links to `https://forgehandyman.com/admin/quotes/{job_id}`.
- **Returning customer badge** in the header when the customer has prior jobs.
- **Duplicate banner** when applicable: "Heads up: customer also submitted N time(s) in the last 24 hours."
- **Customer summary** with `tel:` linked phone, `mailto:` linked email, **Google Maps linked address**.
- **All new fields** displayed (property type, urgency, budget, contact prefs).
- **Secondary links** at the bottom: "View lead in admin" + "Reply to customer."
- **Speed-to-lead footnote**: "First-touch SLA: respond within 4 hours."
- Plain-text version included for accessibility + spam-filter trust.

### Quote builder lead context panel (Amendment §21.4.2 + §21.5.5)

`/admin/quotes/[id]` now shows a collapsible "What the customer told us" panel above the composer:
- Service categories the customer picked (human labels)
- Property type, urgency, budget range, contact prefs (human labels)
- Preferred date, referral source, submitted timestamp, UTM source
- Full description text

Returning-customer badge in the header (e.g., "Returning · 2 prior") when `is_returning_customer = true`.

Every visit to `/admin/quotes/[id]` writes an audit row with `action=quote_builder.opened` (Amendment §21.5.5). If the audit-log write fails, it logs a warning but doesn't block the page render.

### Returning-customer detection

`findPriorJobsByEmail(email)` scans the sheet for matching rows. On contact-form submit, the server runs this lookup, sets `is_returning_customer=true` and `prior_job_count=N` on the new row. Used by both the email (badge in header) and the quote composer (badge above the title).

`countDuplicateLeadsLast24h(email, exceptJobId)` powers the `[2nd]` subject-line prefix.

Both lookups are best-effort — if the sheet read fails for any reason, submission proceeds without the enrichment (warning logged).

---

## Verification performed during development

| Check | Result |
|---|---|
| `npm audit` | unchanged (0 high, 0 critical) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — all routes registered, no new build warnings |

---

## What Mitch needs to do after merge

1. **Create a `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in Google Cloud Console** (for client-side Places Autocomplete):
   - APIs & Services → Credentials → Create credentials → API key
   - Restrict the key:
     - **HTTP referrers**: `https://forgehandyman.com/*` and `https://*.forgehandyman.com/*`
     - **API restrictions**: enable Maps JavaScript API + Places API
   - Paste into Vercel as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (not sensitive, all environments)
   - Redeploy (Vercel doesn't auto-redeploy on env var changes; `NEXT_PUBLIC_*` is build-time)
2. **Run the sheet migration via the new admin page**:
   - Sign in to `/admin`
   - Click **Maintenance** in the top nav (new link)
   - Click **Run sheet migration** → confirm
   - Step-by-step results show backup + header rewrite + Audit tab check
3. **Submit a test form** through the new UI to verify:
   - Address autocomplete suggests verified addresses as you type
   - All new fields land in the right columns
   - Notification email has the "Build Quote →" button and shows all the new field rows

### What about existing rows?

Existing rows from earlier submissions will have empty values for columns Y–AG. That's fine — the quote composer's context panel renders "—" for missing fields. New submissions will populate everything.

---

## Deferred (Stage 6b)

- **Photo upload**: customer attaches 1–3 photos on the contact form. Uploaded via the service account to a Google Drive folder per job, URLs saved to column AE. Admin photo panel on `/admin/jobs/[id]` with thumbnails + lightbox.

## Explicitly NOT applied from the amendment

- **PostgreSQL migration** (§5.1, §21.2). Amendment assumes a DB. We use a Sheet. Migration to a real DB is a future decision when volume justifies it.
- **`service_catalog` table with line items** (§21.2). We don't have a line-item quote model. Our composer takes a flat deposit + balance amount. Adding line items is a separate stage if/when we want it.
- **Magic-link auth** (§21.5.2). We have Google OAuth via NextAuth v4 — magic links would be a parallel auth method, not needed.
- **Pattern-matched pre-suggestions** (§21.4.4). Amendment itself marks this as Phase 2.

---

## Things to watch in Stage 6b / later

- The form is now ~12 visible fields. If conversion drops, we can A/B-test removing optional fields (urgency, budget, contact prefs default to sensible values).
- The notification email is now noticeably longer. Worth checking on mobile email clients (iOS Mail, Gmail mobile, Outlook mobile) that the "Build Quote →" button stays prominent above the fold.
- `findPriorJobsByEmail` reads the full sheet on every form submit. At Forge's current scale this is fine. If volume grows, add a server-side cache or graduate to a real DB.
