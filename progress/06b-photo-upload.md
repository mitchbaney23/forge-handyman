# Stage 6b — Photo Upload

Date: 2026-05-25
Branch: `stage/06b-photo-upload`

Customer can attach up to 6 photos on the contact form. Photos live in Google Drive (`Forge Photos / {job_id} / *`) under `admin@forgehandyman.com`'s own Drive — Mitch sees them directly without sharing flows.

---

## What shipped

### Customer-facing

A new **Photos** section on the contact form, just below the description:
- "Add photos" tile with a camera icon — opens the native file picker
- Multi-select supported (Cmd/Ctrl-click to pick multiple at once)
- Up to **6 photos** per submission
- Accepts JPEG, PNG, WebP, HEIC, HEIF (HEIC for iPhone)
- **Client-side compression** before upload:
  - Resizes to max 1920px on the long edge (Canvas API)
  - Re-encodes as JPEG at ~82% quality
  - Skips compression for HEIC (browsers can't decode) and tiny files (<200KB)
  - Typical iPhone photo: ~4MB → ~500KB without visible quality loss
- Per-photo upload as soon as it's picked (parallel UX feel without overwhelming the server)
- Thumbnails with a remove (×) button on hover
- Inline error messages if any uploads fail
- Server-side max 10MB per file as a safety net

### Server-side

- `lib/drive/upload.ts` — `uploadPhoto()` + folder ensure helpers. Uses the existing service account via domain-wide delegation, with the **`drive.file`** scope (most-scoped Drive permission: only files the app creates).
- `app/api/upload-photo/route.ts` — POST endpoint that accepts one image at a time. Validates MIME type, validates job_id is a real UUID v4, rate-limits per IP (reuses the contact-form-hour limiter), uploads to Drive, returns `{id, url, thumbnailUrl, name}`.
- Folder structure (auto-created on first upload):
  ```
  My Drive/
    Forge Photos/
      {job_id}/
        1716651234-broken-faucet.jpg
        1716651235-wall-damage.jpg
        ...
  ```
- Module-scoped cache for folder IDs so we don't re-fetch on every upload.

### Form submission flow (client → server)

1. Customer adds a photo → form generates a UUID v4 for `jobId` (lazy — only on first photo upload) and sends `(jobId, file)` to `/api/upload-photo`
2. Server validates, uploads to Drive, returns the Drive URL
3. Client stores the URL in component state, shows the thumbnail
4. When customer submits the form, the payload includes both:
   - `jobId` (same UUID used for the photos)
   - `photoUrls`: array of Drive URLs
5. Server-side `/api/contact` uses the provided `jobId` directly (instead of generating one). The sheet row is written with `photo_urls` set to the comma-separated URL list — same job_id matches the Drive folder.

### Admin-facing

- **Photos panel** on `/admin/jobs/[id]` — shows count + tile per photo. Each tile is a button linking to the Drive file (opens in new tab). Empty state when no photos.
- **Notification email** has a new "Photos (N)" section listing each photo as a "View photo N in Drive" link.

### Schema impact

No new sheet columns needed — Stage 6a reserved column **`AD` (`photo_urls`)** for exactly this. The contact form route now populates it with comma-separated URLs.

### Updated icons

Added `camera` and `spinner` to `lib/icons.tsx` for the photo picker UI.

---

## Manual step Mitch needs to do — add the Drive scope to DWD

This unblocks the photo upload server-side. **~30 seconds.**

1. Open https://admin.google.com signed in as `admin@forgehandyman.com`
2. **Security → Access and data control → API controls**
3. Scroll to "Domain wide delegation" → **Manage Domain Wide Delegation**
4. Find your existing service account row (the long `client_id` number)
5. Click **Edit**
6. In the OAuth scopes field, **append** this scope to the existing list (comma-separated, no trailing comma):
   ```
   https://www.googleapis.com/auth/drive.file
   ```
   So the full list becomes:
   ```
   https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/spreadsheets,https://www.googleapis.com/auth/drive.file
   ```
7. **Authorize**

That's it. Photo upload will work immediately after — no redeploy needed (the scope is authorized via Workspace, not via env vars).

### Why `drive.file` and not full Drive access

`drive.file` is the most-restricted Drive scope Google offers. The service account can only:
- See files it created via the API
- Modify files it created via the API
- Delete files it created via the API

It **cannot** see or touch any other file in your Drive — your business records, customer documents, anything else. Strictly limited blast radius. If the service account credentials ever leaked, the attacker could only access photos uploaded through Forge's contact form (which they could see anyway in the public Drive folder if they had the URL).

---

## Verification performed during development

| Check | Result |
|---|---|
| `npm audit` | unchanged (0 high, 0 critical) |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run build` | clean — new route `/api/upload-photo` registered |

---

## Live smoke test (after merge + deploy)

1. Add the `drive.file` DWD scope (above)
2. Submit a test form at `forgehandyman.com/contact`:
   - Fill out as normal
   - Pick 1-2 photos from your phone or laptop
   - Verify thumbnails appear after upload (a few seconds each)
   - Submit
3. Check Gmail — notification email should have a Photos section with one "View photo N" link per photo
4. Open `admin@forgehandyman.com`'s Google Drive → "Forge Photos / {your test job_id}" folder should exist with photos inside
5. Sign in to `/admin` → find your test job → Photos panel shows tiles for each
6. Click a tile → opens in Drive

---

## Deferred / explicit non-goals

- **Inline image preview in admin** — currently shows linked tiles, not inline thumbnails. Inline images would require either Drive's thumbnail endpoint (auth-tricky, requires signed URLs) or storing thumbnails ourselves (more infra). The tile-link approach is "good enough" for v1 — one click to view.
- **Photo deletion** — once uploaded, customers can remove from the form before submit but not after. Admin can delete via Drive UI directly. Adding a delete button in admin would require another action + auth check. Punt for now.
- **Abandoned upload cleanup** — if a customer uploads photos and never submits the form, the Drive folder lingers. Acceptable cruft for now (a few hundred KB per abandonment). Add a periodic cron in Stage 7 if it becomes a real issue.
- **EXIF stripping** — photos may carry GPS location and device info in EXIF metadata. We're not stripping this. For most customer use cases that's fine, but worth noting from a privacy perspective. Could add server-side strip via `sharp` if we want.
- **Virus scanning** — files aren't scanned for malware. Vercel runtime sandboxes them anyway, and we only re-serve via Drive links (not direct download from our domain), so the practical risk is low. Skipping.
