import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { uploadPhoto } from '@/lib/drive/upload'
import { logger } from '@/lib/security/logger'
import {
  checkLimit,
  extractIp,
  rateLimitHeaders,
} from '@/lib/security/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB pre-compression (client should send ~1MB)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: message }, { status, headers })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = extractIp(request)

  // Reuse the contact-form rate limiter — uploads are part of the same
  // submission session and should be capped at the same per-IP volume.
  const limit = await checkLimit('contact-form-hour', `photo:${ip}`)
  if (!limit.success) {
    return jsonError('Too many uploads. Please wait a bit.', 429, rateLimitHeaders(limit))
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return jsonError('Invalid form data.', 400)
  }

  const jobId = form.get('jobId')
  if (typeof jobId !== 'string' || !UUID_REGEX.test(jobId)) {
    return jsonError('Invalid job ID.', 400)
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return jsonError('No file provided.', 400)
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    return jsonError(
      'Unsupported file type. Use JPG, PNG, WebP, or HEIC.',
      415,
    )
  }

  if (file.size === 0) {
    return jsonError('File is empty.', 400)
  }
  if (file.size > MAX_BYTES) {
    return jsonError(
      `File too large (${Math.round(file.size / 1024 / 1024)} MB). Max 10 MB.`,
      413,
    )
  }

  let arrayBuffer: ArrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'upload-photo', step: 'arrayBuffer' } })
    return jsonError("Couldn't read file.", 500)
  }

  const safeName = (file.name || 'photo')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 60)
  const timestampedName = `${Date.now()}-${safeName}`

  try {
    const uploaded = await uploadPhoto({
      jobId,
      fileName: timestampedName,
      mimeType: file.type,
      buffer: Buffer.from(arrayBuffer),
    })
    logger.info(
      { ip, jobId, driveFileId: uploaded.id, bytes: file.size, mimeType: file.type },
      'upload-photo: drive upload succeeded',
    )
    return NextResponse.json({
      ok: true,
      photo: {
        id: uploaded.id,
        url: uploaded.webViewLink,
        thumbnailUrl: uploaded.thumbnailLink,
        name: uploaded.name,
      },
    })
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'upload-photo', step: 'drive-upload' },
      extra: { jobId },
    })
    logger.error({ err, jobId, ip }, 'upload-photo: drive upload failed')
    return jsonError(
      "We couldn't upload that photo. You can submit without photos and reply to the confirmation email with them.",
      502,
    )
  }
}
