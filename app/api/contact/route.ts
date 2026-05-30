import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { checkServiceArea } from '@/lib/geocoding'
import { SERVICE_LABEL_BY_CODE, type ServiceCategoryCode } from '@/lib/constants'
import {
  createCalendarEvent,
  sendNotificationEmail,
  type ContactSubmission,
} from '@/lib/google'
import {
  contactMethodSchema,
  contactTimeSchema,
  propertyTypeSchema,
  serviceCategoriesArraySchema,
  urgencySchema,
} from '@/lib/security/contact-schemas'
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
import {
  countDuplicateLeadsLast24h,
  findPriorJobsByEmail,
} from '@/lib/sheet/queries'
import { appendContactRow, type ContactRow } from '@/lib/sheet/repo'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const contactSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema,
    email: emailSchema,
    address: shortTextSchema,
    serviceCategories: serviceCategoriesArraySchema.optional().default([]),
    notSure: z.boolean().optional().default(false),
    propertyType: propertyTypeSchema,
    preferredDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
    description: freeTextSchema,
    urgency: urgencySchema,
    bestContactTime: contactTimeSchema,
    bestContactMethod: contactMethodSchema,
    referralSource: z
      .string()
      .max(80)
      .optional()
      .transform((s) => (s && s.trim() ? s.trim() : 'Not specified')),
    website: honeypotSchema,
    turnstileToken: z.string().min(1).optional(),
    utmSource: z.string().max(120).optional().transform((s) => (s ? s.trim() : '')),
    // Optional client-generated job_id (used to group photo uploads in
    // Drive). Must be UUID v4 format; server falls back to generating
    // its own if missing/invalid.
    jobId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      .optional(),
    photoUrls: z.array(z.string().url()).max(6).optional().default([]),
  })
  .refine(
    (v) => v.notSure || (v.serviceCategories && v.serviceCategories.length >= 1),
    {
      message: "Pick at least one service, or check 'I'm not sure'",
      path: ['serviceCategories'],
    },
  )

type ContactPayload = z.infer<typeof contactSchema>

interface DerivedServiceInfo {
  serviceType: string // 'multiple' / 'other' / one of the 8 category codes
  serviceTypeLabel: string // human label for the email subject
  serviceCategoriesCsv: string // comma-separated codes, or '' for 'other'
}

function deriveServiceInfo(payload: ContactPayload): DerivedServiceInfo {
  if (payload.notSure) {
    return {
      serviceType: 'other',
      serviceTypeLabel: SERVICE_LABEL_BY_CODE.other,
      serviceCategoriesCsv: '',
    }
  }
  const codes = payload.serviceCategories ?? []
  if (codes.length === 1) {
    const code = codes[0] as ServiceCategoryCode
    return {
      serviceType: code,
      serviceTypeLabel: SERVICE_LABEL_BY_CODE[code] ?? code,
      serviceCategoriesCsv: code,
    }
  }
  return {
    serviceType: 'multiple',
    serviceTypeLabel: SERVICE_LABEL_BY_CODE.multiple,
    serviceCategoriesCsv: codes.join(','),
  }
}

function isDevMode(): boolean {
  return process.env.NEXT_PUBLIC_DEV_MODE === 'true'
}

function isContactFormDisabled(): boolean {
  return process.env.CONTACT_FORM_DISABLED === 'true'
}

function jsonError(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status, headers })
}

function payloadToSubmission(
  payload: ContactPayload,
  derived: DerivedServiceInfo,
  submittedAt: string,
  enriched: {
    jobId: string
    isReturningCustomer: boolean
    priorJobCount: number
    duplicateLast24hCount: number
  },
): ContactSubmission {
  return {
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    serviceType: derived.serviceTypeLabel,
    preferredDate: payload.preferredDate,
    description: payload.description,
    referralSource: payload.referralSource,
    submittedAt,
    jobId: enriched.jobId,
    propertyType: payload.propertyType,
    urgency: payload.urgency,
    bestContactTime: payload.bestContactTime,
    bestContactMethod: payload.bestContactMethod,
    isReturningCustomer: enriched.isReturningCustomer,
    priorJobCount: enriched.priorJobCount,
    duplicateLast24hCount: enriched.duplicateLast24hCount,
    photoUrls: payload.photoUrls ?? [],
  }
}

function payloadToRow(
  payload: ContactPayload,
  derived: DerivedServiceInfo,
  submittedAt: string,
  jobId: string,
  isReturningCustomer: boolean,
  priorJobCount: number,
): ContactRow {
  return {
    submitted_at: submittedAt,
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    service_type: derived.serviceType,
    preferred_date: payload.preferredDate,
    description: payload.description,
    referral_source: payload.referralSource,
    status: 'New',
    utm_source: payload.utmSource,
    job_id: jobId,
    service_categories: derived.serviceCategoriesCsv,
    property_type: payload.propertyType,
    urgency: payload.urgency,
    best_contact_time: payload.bestContactTime,
    best_contact_method: payload.bestContactMethod,
    photo_urls: (payload.photoUrls ?? []).join(','),
    is_returning_customer: isReturningCustomer ? 'true' : '',
    prior_job_count: String(priorJobCount),
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = extractIp(request)
  const submittedAt = new Date().toISOString()

  // Kill switch: when CONTACT_FORM_DISABLED=true, refuse submissions with a
  // friendly maintenance message before doing any work. The `maintenance`
  // flag lets the client render a distinct notice (not a generic error).
  if (isContactFormDisabled()) {
    logger.info({ ip }, 'contact-form: submission rejected — CONTACT_FORM_DISABLED')
    return jsonError(
      "We're updating our booking system right now. Please call us at (555) 123-4567 and we'll get you taken care of.",
      503,
      { maintenance: true },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Invalid request format.', 400)
  }

  // Honeypot: bots fill `website`; humans don't see it.
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
      'Too many requests. Please wait a bit before submitting again, or call us at (555) 123-4567.',
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

  // Use the client-provided job_id if valid (so photos uploaded under that
  // ID match the row we're about to write). Otherwise generate fresh.
  const jobId = payload.jobId ?? randomUUID()
  const derived = deriveServiceInfo(payload)

  // Look up returning-customer info in parallel (cheap; both read the sheet).
  let isReturningCustomer = false
  let priorJobCount = 0
  let duplicateLast24hCount = 0
  if (!isDevMode()) {
    try {
      const [prior, dupCount] = await Promise.all([
        findPriorJobsByEmail(payload.email, jobId),
        countDuplicateLeadsLast24h(payload.email, jobId),
      ])
      priorJobCount = prior.count
      isReturningCustomer = prior.count > 0
      duplicateLast24hCount = dupCount
    } catch (err) {
      // Don't block submission if the lookup fails — log it.
      logger.warn({ err }, 'contact-form: prior-customer lookup failed')
    }
  }

  const submission = payloadToSubmission(payload, derived, submittedAt, {
    jobId,
    isReturningCustomer,
    priorJobCount,
    duplicateLast24hCount,
  })
  const row = payloadToRow(
    payload,
    derived,
    submittedAt,
    jobId,
    isReturningCustomer,
    priorJobCount,
  )

  logger.info(
    {
      ip,
      jobId,
      submittedAt,
      maskedEmail: maskEmail(payload.email),
      maskedPhone: maskPhone(payload.phone),
      serviceType: derived.serviceType,
      utmSource: payload.utmSource || undefined,
      isReturningCustomer,
      priorJobCount,
      duplicateLast24h: duplicateLast24hCount,
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
      "We couldn't send your request right now. Please call (555) 123-4567 or try again in a few minutes.",
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
