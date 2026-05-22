import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { checkServiceArea } from '@/lib/geocoding'
import {
  createCalendarEvent,
  sendNotificationEmail,
  type ContactSubmission,
} from '@/lib/google'
import { logger, maskEmail, maskPhone } from '@/lib/security/logger'
import {
  checkLimit,
  extractIp,
  rateLimitHeaders,
} from '@/lib/security/rate-limit'
import { verifyTurnstileToken } from '@/lib/security/turnstile'
import {
  emailSchema,
  fieldErrorsFromZod,
  freeTextSchema,
  honeypotSchema,
  nameSchema,
  phoneSchema,
  shortTextSchema,
} from '@/lib/security/zod'
import { appendContactRow, type ContactRow } from '@/lib/sheet/repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const contactSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
  address: shortTextSchema,
  serviceType: shortTextSchema.refine((s) => s.length <= 80, 'Service type too long'),
  preferredDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
  description: freeTextSchema,
  referralSource: z
    .string()
    .max(80)
    .optional()
    .transform((s) => (s && s.trim() ? s.trim() : 'Not specified')),
  website: honeypotSchema,
  turnstileToken: z.string().min(1).optional(),
  utmSource: z.string().max(120).optional().transform((s) => (s ? s.trim() : '')),
})

type ContactPayload = z.infer<typeof contactSchema>

function isDevMode(): boolean {
  return process.env.NEXT_PUBLIC_DEV_MODE === 'true'
}

function jsonError(message: string, status: number, extra?: Record<string, unknown>, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status, headers })
}

function payloadToSubmission(payload: ContactPayload, submittedAt: string): ContactSubmission {
  return {
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    serviceType: payload.serviceType,
    preferredDate: payload.preferredDate,
    description: payload.description,
    referralSource: payload.referralSource,
    submittedAt,
  }
}

function payloadToRow(
  payload: ContactPayload,
  submittedAt: string,
  jobId: string,
): ContactRow {
  return {
    submitted_at: submittedAt,
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    service_type: payload.serviceType,
    preferred_date: payload.preferredDate,
    description: payload.description,
    referral_source: payload.referralSource,
    status: 'New',
    utm_source: payload.utmSource,
    job_id: jobId,
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = extractIp(request)
  const submittedAt = new Date().toISOString()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid request format.', 400)
  }

  // Honeypot: bots fill `website`; humans don't see it. Return 200 silently
  // so the bot thinks it succeeded and is less likely to retry.
  if (
    body !== null &&
    typeof body === 'object' &&
    'website' in body &&
    typeof (body as { website?: unknown }).website === 'string' &&
    ((body as { website: string }).website || '').length > 0
  ) {
    logger.info({ ip }, 'contact-form: honeypot tripped — dropping submission')
    return NextResponse.json({ ok: true })
  }

  const parsed = contactSchema.safeParse(body)
  if (!parsed.success) {
    return jsonError('Validation failed.', 422, {
      fieldErrors: fieldErrorsFromZod(parsed.error),
    })
  }
  const payload = parsed.data

  // Rate limit: 5/hr and 20/day per IP. Both must allow.
  const [hourly, daily] = await Promise.all([
    checkLimit('contact-form-hour', ip),
    checkLimit('contact-form-day', ip),
  ])
  if (!hourly.success || !daily.success) {
    const blocking = !hourly.success ? hourly : daily
    logger.warn(
      { ip, route: 'contact-form', limit: !hourly.success ? 'hour' : 'day' },
      'contact-form: rate limited',
    )
    return jsonError(
      'Too many requests. Please wait a bit before submitting again, or call us at (828) 551-9690.',
      429,
      undefined,
      rateLimitHeaders(blocking),
    )
  }

  const turnstile = await verifyTurnstileToken(payload.turnstileToken, ip)
  if (!turnstile.success) {
    logger.warn(
      { ip, errorCodes: turnstile.errorCodes },
      'contact-form: turnstile verification failed',
    )
    return jsonError('Verification failed — please try again.', 403)
  }

  const serviceArea = await checkServiceArea(payload.address)
  if (!serviceArea.inArea) {
    return NextResponse.json({
      ok: false,
      outOfArea: true,
      distanceMiles: Math.round(serviceArea.distanceMiles * 10) / 10,
      radiusMiles: serviceArea.radiusMiles,
    })
  }

  const jobId = randomUUID()
  const submission = payloadToSubmission(payload, submittedAt)
  const row = payloadToRow(payload, submittedAt, jobId)

  logger.info(
    {
      ip,
      jobId,
      submittedAt,
      maskedEmail: maskEmail(payload.email),
      maskedPhone: maskPhone(payload.phone),
      serviceType: payload.serviceType,
      utmSource: payload.utmSource || undefined,
    },
    'contact-form: submission accepted',
  )

  if (isDevMode()) {
    logger.info({ submittedAt }, 'contact-form: DEV_MODE active — skipping third-party calls')
    return NextResponse.json({ ok: true, mode: 'dev' })
  }

  try {
    await sendNotificationEmail(submission)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'contact-form', step: 'gmail-send' },
    })
    logger.error({ err }, 'contact-form: Gmail send failed')
    return jsonError(
      "We couldn't send your request right now. Please call (828) 551-9690 or try again in a few minutes.",
      502,
    )
  }

  const [calendarResult, sheetResult] = await Promise.allSettled([
    createCalendarEvent(submission),
    appendContactRow(row),
  ])

  if (calendarResult.status === 'rejected') {
    Sentry.captureException(calendarResult.reason, {
      tags: { route: 'contact-form', step: 'calendar-create' },
    })
    logger.error({ err: calendarResult.reason }, 'contact-form: calendar event failed')
  }
  if (sheetResult.status === 'rejected') {
    Sentry.captureException(sheetResult.reason, {
      tags: { route: 'contact-form', step: 'sheet-append' },
    })
    logger.error({ err: sheetResult.reason }, 'contact-form: sheet append failed')
  }

  return NextResponse.json({ ok: true })
}
