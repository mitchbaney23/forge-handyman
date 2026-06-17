import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { cartSchema } from '@/lib/security/contact-schemas'
import { cartJobMinutes } from '@/lib/cart'
import { getDefaultTechnician, listAppointmentsInRange } from '@/lib/data'
import {
  getAvailabilityWindows,
  getBusyIntervals,
} from '@/lib/scheduling/availability'
import { computeAvailableSlots, type Interval } from '@/lib/scheduling/slots'
import { BOOKING_WINDOW_DAYS } from '@/lib/scheduling/config'
import { logger } from '@/lib/security/logger'
import { checkLimit, extractIp, rateLimitHeaders } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MS_PER_DAY = 86_400_000
const MAX_CART_PARAM = 4_000

// Public, unauthenticated: given the customer's cart, return the technician's
// open slots sized to the job. Job duration is derived SERVER-SIDE from the cart
// (never trusted from the client). Availability + free/busy come from the
// technician's Google Calendar; existing Forge bookings are layered on top.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ip = extractIp(request)
  const rl = await checkLimit('scheduling-availability', ip)
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: rateLimitHeaders(rl) },
    )
  }

  // Parse + validate the cart from the query string.
  const raw = request.nextUrl.searchParams.get('cart')
  if (!raw || raw.length > MAX_CART_PARAM) {
    return NextResponse.json({ error: 'A valid cart is required.' }, { status: 400 })
  }
  let cart
  try {
    cart = cartSchema.parse(JSON.parse(raw))
  } catch {
    return NextResponse.json({ error: 'A valid cart is required.' }, { status: 400 })
  }

  const jobMinutes = cartJobMinutes(cart)

  try {
    const tech = await getDefaultTechnician()
    if (!tech) {
      // No technician configured yet — no self-serve availability (the form
      // falls back to the callback flow).
      return NextResponse.json(
        { slotsByDay: [], tooLongForWindow: false, noTechnician: true },
        { headers: rateLimitHeaders(rl) },
      )
    }

    const now = new Date()
    const from = now.toISOString()
    const to = new Date(now.getTime() + BOOKING_WINDOW_DAYS * MS_PER_DAY).toISOString()

    const [windows, freebusy, appts] = await Promise.all([
      getAvailabilityWindows(tech, { from, to }),
      getBusyIntervals(tech, { from, to }),
      listAppointmentsInRange(from, to),
    ])

    const apptIntervals: Interval[] = appts.map((a) => ({
      start: Date.parse(a.startsAt),
      end: Date.parse(a.endsAt),
    }))

    const result = computeAvailableSlots({
      now,
      jobMinutes,
      availabilityWindows: windows,
      busyIntervals: [...freebusy, ...apptIntervals],
    })

    return NextResponse.json(result, {
      headers: {
        ...rateLimitHeaders(rl),
        // Near-live; the booking submit re-checks atomically, so a minute of
        // staleness only costs a repick on the rare race.
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      },
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'scheduling-availability' } })
    logger.error({ err }, 'scheduling-availability: failed to compute slots')
    return NextResponse.json(
      { error: 'Availability is temporarily unavailable.' },
      { status: 503, headers: rateLimitHeaders(rl) },
    )
  }
}
