import { randomUUID } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { checkServiceArea } from '@/lib/geocoding'
import { BUSINESS, SERVICE_LABEL_BY_CODE, type ServiceCategoryCode } from '@/lib/constants'
import {
  cartJobMinutes,
  deriveServiceCategories,
  formatCartSummary,
  isCartEmpty,
  resolveCart,
} from '@/lib/cart'
import {
  createBookingEvent,
  createCalendarEvent,
  deleteBookingEvent,
  sendBookingConfirmationToCustomer,
  sendLeadAcknowledgmentToCustomer,
  sendNotificationEmail,
  type ContactSubmission,
} from '@/lib/google'
import { buildCancelUrl } from '@/lib/scheduling/cancel-token'
import {
  getAvailabilityWindows,
  getBusyIntervals,
} from '@/lib/scheduling/availability'
import { computeAvailableSlots } from '@/lib/scheduling/slots'
import { BOOKING_WINDOW_DAYS } from '@/lib/scheduling/config'
import { easternIsoDate } from '@/lib/scheduling/time'
import { ACTIONS, ACTORS } from '@/lib/data/activity-actions'
import {
  cartSchema,
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
  honeypotSchema,
  nameSchema,
  phoneSchema,
  shortTextSchema,
} from '@/lib/security/zod'
import {
  appendAuditRow,
  appendContactRow,
  claimSlot,
  countDuplicateLeadsLast24h,
  findPriorJobsByEmail,
  getDefaultTechnician,
  linkAppointment,
  listAppointmentsInRange,
  releaseSlot,
  updateRowByJobId,
  type ContactRow,
} from '@/lib/data'
import {
  dispatchBookingToDavid,
  dispatchJobToDavid,
  notifyMitchBooking,
  notifyMitchNewLead,
} from '@/lib/telegram/dispatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const contactSchema = z
  .object({
    name: nameSchema,
    phone: phoneSchema,
    email: emailSchema,
    address: shortTextSchema,
    serviceCategories: serviceCategoriesArraySchema.optional().default([]),
    cart: cartSchema.optional(),
    notSure: z.boolean().optional().default(false),
    // Forge Family friends-and-family discount. Carried from the /family link
    // (?family=1). Honor-system (no payment at booking), so the client flag is
    // trusted — the server just reflects family pricing in the lead + summary.
    family: z.boolean().optional().default(false),
    propertyType: propertyTypeSchema,
    preferredDate: z
      .union([
        z.literal(''),
        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format'),
      ])
      .optional()
      .default(''),
    // Optional notes. The cart carries the job detail now, so a menu-picker
    // can leave this blank; it's required only on the "not sure" path (see the
    // refine below). Sanitize/cap exactly like freeTextSchema, but allow empty.
    description: z
      .string()
      .max(2000, 'Too long (max 2000 characters)')
      .optional()
      .default('')
      .transform((s) =>
        s
          .trim()
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' '),
      ),
    // Optional access details (gate code, parking, pets, lockbox). Folded into
    // the stored description below so the Telegram card and admin job page
    // surface it without a schema change. Same sanitization as description.
    accessNotes: z
      .string()
      .max(300, 'Too long (max 300 characters)')
      .optional()
      .default('')
      .transform((s) =>
        s
          .trim()
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' '),
      ),
    // Urgency is the fallback-path timing hint; a scheduled booking carries an
    // exact slot instead, so it's optional now.
    urgency: urgencySchema.optional(),
    // A customer-chosen appointment slot (self-scheduling). ISO instants;
    // re-validated server-side against live availability before booking — never
    // trusted as-is.
    selectedSlot: z
      .object({
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
      })
      .optional(),
    // No longer collected on the form (customers pick a real slot now); kept
    // optional with an 'any' default for back-compat with the stored columns
    // and any in-flight clients.
    bestContactTime: contactTimeSchema.optional().default('any'),
    bestContactMethod: contactMethodSchema.optional().default('any'),
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
    (v) =>
      v.notSure ||
      (v.serviceCategories && v.serviceCategories.length >= 1) ||
      (v.cart != null && !isCartEmpty(v.cart)),
    {
      message: "Pick at least one service or a package, or check 'I'm not sure'",
      // Key to the live form field (`cart`) so the client highlights it and
      // scrolls to step 1 — `serviceCategories` no longer exists on the form.
      path: ['cart'],
    },
  )
  .refine(
    // On the "not sure / custom job" path the description IS the job, so it's
    // required there. When a cart was picked, the cart says what the job is.
    (v) => !v.notSure || v.description.trim().length > 0,
    {
      message: "Since you're not sure, tell us a bit about the work",
      path: ['description'],
    },
  )

type ContactPayload = z.infer<typeof contactSchema>

interface DerivedServiceInfo {
  serviceType: string // 'multiple' / 'other' / one of the 8 category codes
  serviceTypeLabel: string // human label for the email subject
  serviceCategoriesCsv: string // comma-separated codes, or '' for 'other'
}

function deriveServiceInfo(payload: ContactPayload): DerivedServiceInfo {
  // Cart-driven derivation takes precedence when a non-empty cart is present.
  if (payload.cart && !isCartEmpty(payload.cart)) {
    const cart = payload.cart
    const { lines, pkg } = resolveCart(cart)
    // Defensive: a cart that resolves to nothing (only stale/unknown ids from a
    // since-changed menu) must not become "Menu order: 0 items" — fall back to a
    // generic request so the lead still reads sensibly downstream.
    if (!pkg && lines.length === 0) {
      return {
        serviceType: 'other',
        serviceTypeLabel: SERVICE_LABEL_BY_CODE.other,
        serviceCategoriesCsv: '',
      }
    }
    const serviceType = pkg
      ? pkg.name
      : `Menu order: ${lines.length} item${lines.length === 1 ? '' : 's'}`
    return {
      serviceType,
      serviceTypeLabel: serviceType,
      serviceCategoriesCsv: deriveServiceCategories(cart).join(','),
    }
  }
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
    family: payload.family,
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
  // When a cart is present, lead the description with its plain-text summary,
  // then append the customer's free-text note (if any). Otherwise the
  // description is the free-text note unchanged.
  const cartDesc =
    payload.cart && !isCartEmpty(payload.cart)
      ? formatCartSummary(payload.cart, { family: payload.family }) +
        (payload.description ? '\n\n' + payload.description : '')
      : payload.description
  // Tag family leads so David sees the discount at a glance (flows to the
  // notification email, Telegram card, and admin via the description).
  const taggedDesc = payload.family
    ? `🏷️ FORGE FAMILY — 30% off applied\n\n${cartDesc}`
    : cartDesc
  // Access notes ride the description too — David reads the dispatch card at
  // the door, so "🔑 Access:" must be impossible to miss.
  const description = payload.accessNotes
    ? `${taggedDesc}${taggedDesc ? '\n\n' : ''}🔑 Access: ${payload.accessNotes}`
    : taggedDesc

  return {
    submitted_at: submittedAt,
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    address: payload.address,
    service_type: derived.serviceType,
    preferred_date: payload.preferredDate,
    description,
    referral_source: payload.referralSource,
    status: 'New',
    utm_source: payload.utmSource,
    job_id: jobId,
    service_categories: derived.serviceCategoriesCsv,
    property_type: payload.propertyType,
    urgency: payload.urgency ?? '',
    best_contact_time: payload.bestContactTime,
    best_contact_method: payload.bestContactMethod,
    photo_urls: (payload.photoUrls ?? []).join(','),
    is_returning_customer: isReturningCustomer ? 'true' : '',
    prior_job_count: String(priorJobCount),
  }
}

const MS_PER_DAY = 86_400_000

// Auto-confirm a customer-chosen slot. Returns a NextResponse when scheduling
// was attempted (success, slot-taken 409, or error), or null to fall through to
// the normal lead-capture flow (e.g. no technician/calendar configured yet).
//
// Order matters — claim BEFORE writing the job so a taken slot fails fast with
// nothing persisted, and compensate (release slot / delete event) on any later
// failure so we never leave a phantom hold or orphan event.
async function handleScheduledBooking(args: {
  payload: ContactPayload
  jobId: string
  row: ContactRow
  submission: ContactSubmission
  slot: { startsAt: string; endsAt: string }
}): Promise<NextResponse | null> {
  const { payload, jobId, row, submission, slot } = args

  const tech = await getDefaultTechnician()
  if (!tech || !tech.calendarEmail) {
    logger.warn('contact-form: scheduled booking requested but no technician/calendar — falling back to lead')
    return null
  }

  const jobMinutes = payload.cart ? cartJobMinutes(payload.cart) : 0
  const now = new Date()
  const from = now.toISOString()
  const to = new Date(now.getTime() + BOOKING_WINDOW_DAYS * MS_PER_DAY).toISOString()

  // Re-validate the chosen slot against LIVE availability — authoritative, never
  // trust the client. It must be a slot we'd currently offer (right duration,
  // within an open window, not busy, respects lead time).
  try {
    const [windows, freebusy, appts] = await Promise.all([
      getAvailabilityWindows(tech, { from, to }),
      getBusyIntervals(tech, { from, to }),
      listAppointmentsInRange(from, to),
    ])
    const busy = [
      ...freebusy,
      ...appts.map((a) => ({ start: Date.parse(a.startsAt), end: Date.parse(a.endsAt) })),
    ]
    const { slotsByDay } = computeAvailableSlots({
      now,
      jobMinutes,
      availabilityWindows: windows,
      busyIntervals: busy,
    })
    const offered = slotsByDay.some((d) =>
      d.slots.some((s) => s.startsAt === slot.startsAt && s.endsAt === slot.endsAt),
    )
    if (!offered) {
      return jsonError('That time is no longer available — please pick another.', 409, {
        error: 'slot_taken',
        refreshAvailability: true,
      })
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'contact-form', step: 'slot-revalidate' } })
    logger.error({ err }, 'contact-form: slot re-validation failed')
    return jsonError("We couldn't confirm that time right now. Please try again.", 503)
  }

  // Atomically claim the slot (job_id null until the jobs row exists).
  let appt
  try {
    appt = await claimSlot({
      jobId: '',
      technicianId: tech.id,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'contact-form', step: 'claim-slot' } })
    logger.error({ err }, 'contact-form: claim_slot failed')
    return jsonError("We couldn't confirm that time right now. Please try again.", 503)
  }
  if (!appt) {
    return jsonError('That time was just taken — please pick another.', 409, {
      error: 'slot_taken',
      refreshAvailability: true,
    })
  }

  // Create the firm calendar event on the technician's calendar.
  let eventId = ''
  try {
    eventId = await createBookingEvent({
      subject: tech.calendarEmail,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      data: submission,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'contact-form', step: 'booking-event' } })
    logger.error({ err }, 'contact-form: createBookingEvent failed')
    await releaseSlot(appt.id).catch(() => {})
    return jsonError("We couldn't confirm that time right now. Please try again.", 502)
  }

  // Persist the job as Booked, then link the appointment to it.
  const bookedRow: ContactRow = {
    ...row,
    status: 'Booked',
    preferred_date: easternIsoDate(new Date(slot.startsAt)),
  }
  try {
    await appendContactRow(bookedRow)
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'contact-form', step: 'sheet-append-booked' } })
    logger.error({ err }, 'contact-form: booked job append failed')
    await releaseSlot(appt.id).catch(() => {})
    await deleteBookingEvent({ subject: tech.calendarEmail, eventId }).catch(() => {})
    return jsonError("We couldn't complete your booking. Please try again.", 502)
  }
  await linkAppointment(appt.id, { jobId, googleEventId: eventId }).catch((err) => {
    logger.error({ err, jobId }, 'contact-form: linkAppointment failed (non-fatal)')
  })

  // Activity log (best-effort).
  await appendAuditRow({
    actor: ACTORS.SYSTEM,
    action: ACTIONS.APPOINTMENT_SCHEDULED,
    target: jobId,
    jobId,
    notes: `${slot.startsAt} → ${slot.endsAt}`,
  }).catch(() => {})
  await appendAuditRow({
    actor: ACTORS.SYSTEM,
    action: ACTIONS.JOB_BOOKED,
    target: jobId,
    jobId,
  }).catch(() => {})

  // Notifications — booking is already firm, so all best-effort (a comms failure
  // must not undo a confirmed booking).
  try {
    await sendNotificationEmail(submission)
  } catch (err) {
    logger.error({ err, jobId }, 'contact-form: booking notification email failed')
  }
  // Customer confirmation w/ self-cancel link (transactional).
  try {
    await sendBookingConfirmationToCustomer({
      data: submission,
      startsAt: slot.startsAt,
      endsAt: slot.endsAt,
      cancelUrl: buildCancelUrl(appt.id),
    })
  } catch (err) {
    logger.error({ err, jobId }, 'contact-form: customer confirmation email failed')
  }
  if (process.env.DISPATCH_DISABLED !== 'true') {
    try {
      await dispatchBookingToDavid(bookedRow, slot)
    } catch (err) {
      logger.error({ err, jobId }, 'contact-form: booking dispatch to David failed')
    }
    try {
      await notifyMitchBooking(bookedRow, slot)
    } catch (err) {
      logger.error({ err, jobId }, 'contact-form: booking FYI to Mitch failed')
    }
  }

  logger.info({ jobId, startsAt: slot.startsAt }, 'contact-form: booking confirmed')
  return NextResponse.json({ ok: true, booked: { startsAt: slot.startsAt, endsAt: slot.endsAt } })
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
      `We're updating our booking system right now. Please call us at ${BUSINESS.phone} and we'll get you taken care of.`,
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
      `Too many requests. Please wait a bit before submitting again, or call us at ${BUSINESS.phone}.`,
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

  // Self-scheduling: when the customer picked a real slot (known-duration cart,
  // not the custom path), auto-confirm the booking. Falls through to the normal
  // lead flow if scheduling can't run (e.g. no technician configured).
  const slot = payload.selectedSlot
  const wantsBooking =
    !!slot &&
    !payload.notSure &&
    !!payload.cart &&
    !isCartEmpty(payload.cart) &&
    cartJobMinutes(payload.cart) > 0
  if (wantsBooking && slot) {
    const booked = await handleScheduledBooking({ payload, jobId, row, submission, slot })
    if (booked) return booked
  }

  try {
    await sendNotificationEmail(submission)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'contact-form', step: 'gmail-send' },
    })
    logger.error({ err }, 'contact-form: Gmail send failed')
    return jsonError(
      `We couldn't send your request right now. Please call ${BUSINESS.phone} or try again in a few minutes.`,
      502,
    )
  }

  // Customer acknowledgment — this lead path is the non-booking case (callback /
  // flexible / custom / "not sure"); the booking path sends its own "You're
  // booked" email, so between the two every customer we serve gets a reply.
  // Best-effort: the lead is captured and the business notified, so a failure
  // here must never fail the submission.
  try {
    await sendLeadAcknowledgmentToCustomer(submission)
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'contact-form', step: 'customer-ack-email' },
    })
    logger.error({ err, jobId }, 'contact-form: customer acknowledgment email failed')
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

  // Best-effort: dispatch the job to David's Telegram with Approve/Decline/
  // Sub-out buttons. Only runs for in-area, non-dev submissions (we're already
  // past both gates here). Never blocks the customer response. Skipped when
  // DISPATCH_DISABLED=true or the sheet append failed (no row to update).
  if (
    process.env.DISPATCH_DISABLED !== 'true' &&
    sheetResult.status === 'fulfilled'
  ) {
    try {
      const result = await dispatchJobToDavid(row)
      if (result.ok) {
        await updateRowByJobId(jobId, {
          dispatch_status: 'Dispatched',
          telegram_message_id: result.messageId ? String(result.messageId) : '',
        })
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: 'contact-form', step: 'telegram-dispatch' },
      })
      logger.error({ err, jobId }, 'contact-form: telegram dispatch failed')
    }

    // FYI copy to Mitch (no buttons) — separate best-effort so a failure
    // here doesn't affect David's dispatch or the customer response.
    try {
      await notifyMitchNewLead(row)
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: 'contact-form', step: 'telegram-mitch-fyi' },
      })
      logger.error({ err, jobId }, 'contact-form: Mitch FYI failed')
    }
  }

  return NextResponse.json({ ok: true })
}
