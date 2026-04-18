# Forge Handyman Service — Website

Production marketing website for **Forge Handyman Service**, a local
handyman business serving Garner, Clayton, and South Raleigh, NC.

Built with **Next.js 14 (App Router)**, **TypeScript**, and **Tailwind CSS**.
The contact form submits to an API route that simultaneously sends a Gmail
notification, creates a Google Calendar event, and appends a row to a
Google Sheet (lightweight CRM) via the `googleapis` SDK.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template and fill in values
cp .env.example .env.local

# 3. Run the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

With `NEXT_PUBLIC_DEV_MODE=true`, the contact form will log submissions to
the server console instead of calling the Google APIs — useful while you
finish provisioning Google Workspace credentials.

---

## Scripts

| Command             | Purpose                          |
| ------------------- | -------------------------------- |
| `npm run dev`       | Start the Next.js dev server     |
| `npm run build`     | Production build                 |
| `npm run start`     | Start the production server      |
| `npm run lint`      | Run ESLint                       |
| `npm run typecheck` | TypeScript type-check (no emit)  |

---

## Environment Variables

See `.env.example`. Required in production:

| Variable                         | Purpose                                            |
| -------------------------------- | -------------------------------------------------- |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`   | Service account email (IAM)                        |
| `GOOGLE_PRIVATE_KEY`             | Service account private key (keep `\n` literals)   |
| `GOOGLE_CALENDAR_ID`             | Calendar for event creation (usually David's email) |
| `GOOGLE_SHEET_ID`                | Spreadsheet ID of the CRM sheet                    |
| `BUSINESS_EMAIL`                 | Notification destination — `david@forgehandyman.com` |
| `NEXT_PUBLIC_DEV_MODE`           | `true` for local dev (skips Google API calls)      |
| `NEXT_PUBLIC_SITE_URL`           | Canonical site URL — used in metadata + sitemap    |

---

## Google Workspace Setup

The `/api/contact` route authenticates with a Google service account using
**domain-wide delegation** so it can send mail *as* `david@forgehandyman.com`.

### 1. Google Cloud project

1. In [Google Cloud Console](https://console.cloud.google.com), create a
   project (e.g. `forge-handyman-prod`).
2. Enable these APIs:
   - Gmail API
   - Google Calendar API
   - Google Sheets API

### 2. Service account

1. **IAM & Admin → Service Accounts → Create service account.**
2. Name it `forge-handyman-web`. No roles needed at the project level.
3. Create a **JSON key** and download it. You'll copy `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `private_key` → `GOOGLE_PRIVATE_KEY` (keep the `\n` escapes in your env var).
4. Note the numeric **Unique ID** — you need it for domain-wide delegation.

### 3. Domain-wide delegation (Google Workspace admin)

1. In Google Workspace Admin → **Security → Access and data control → API controls → Domain-wide delegation**.
2. **Add new** with the service account's Unique ID and these scopes:

   ```
   https://www.googleapis.com/auth/gmail.send,
   https://www.googleapis.com/auth/calendar,
   https://www.googleapis.com/auth/spreadsheets
   ```

### 4. Google Sheet (the CRM)

1. Create a new Google Sheet. Copy the ID from the URL → `GOOGLE_SHEET_ID`.
2. In row 1 of `Sheet1`, add these headers:
   ```
   Timestamp | Name | Phone | Email | Address | Service Type | Preferred Date | Description | Referral Source | Status
   ```
3. Share the sheet with the service account email, **Editor** access.

### 5. Calendar

The service account acts on behalf of `david@forgehandyman.com` (via
delegation), so no extra sharing is needed — events are created on David's
primary calendar. Set `GOOGLE_CALENDAR_ID=david@forgehandyman.com`.

---

## Deploy to Vercel

1. Push this repo to GitHub.
2. In Vercel, **New Project → Import** the repo. Framework auto-detects as
   Next.js.
3. Add every env var from `.env.example` (production). Paste
   `GOOGLE_PRIVATE_KEY` with real newlines — Vercel handles the escaping.
4. Set `NEXT_PUBLIC_DEV_MODE=false` in production.
5. Deploy. Point your domain at the Vercel project.

`vercel.json` adds basic security headers.

---

## Project Structure

```
forge-handyman/
├── app/
│   ├── layout.tsx            # Root layout, metadata, LocalBusiness JSON-LD
│   ├── page.tsx              # Homepage
│   ├── services/page.tsx
│   ├── about/page.tsx
│   ├── service-area/page.tsx
│   ├── contact/page.tsx
│   ├── not-found.tsx
│   ├── sitemap.ts
│   ├── robots.ts
│   ├── globals.css
│   └── api/contact/route.ts  # Form → Gmail + Calendar + Sheets
├── components/
│   ├── Header.tsx            # Top bar + sticky nav + mobile menu
│   ├── Footer.tsx
│   ├── Hero.tsx
│   ├── TrustBar.tsx
│   ├── ServiceCard.tsx
│   ├── TestimonialCard.tsx
│   ├── ContactForm.tsx       # Client-side validation + submit
│   ├── MobileCTA.tsx         # Sticky bottom bar on mobile
│   ├── CTABanner.tsx
│   └── Logo.tsx
├── lib/
│   ├── constants.ts          # Business info, services, service area, etc.
│   ├── google.ts             # gmail / calendar / sheets client helpers
│   └── icons.tsx             # Inline SVG icon set
├── public/
│   └── favicon.svg
├── .env.example
├── vercel.json
└── README.md
```

---

## Adding Real Photos

Throughout the site, photo placeholders use commented-out `<img>` tags
with descriptive `alt` text right next to the placeholder block. Search
for `Placeholder` or `Photo coming soon` to find them. Drop real assets
into `public/` and un-comment.

---

## Notes

- The contact form rate-limits submissions to 10 per IP per hour (in-memory,
  per-instance). Swap for Vercel KV or Upstash Redis if that becomes a
  real problem.
- Email is the critical path — if that fails the user gets an error. Calendar
  and Sheets failures are logged but don't block the success response.
- No CMS, no DB — content lives in `lib/constants.ts`. Testimonials,
  services, and service area are all edited there.
