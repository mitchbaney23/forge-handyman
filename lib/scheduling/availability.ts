// Google Calendar I/O for scheduling — kept separate from the pure slot
// algorithm (lib/scheduling/slots.ts) so that stays unit-testable. Everything
// here is per-technician: the service account impersonates the tech's
// @forgehandyman.com account (domain-wide delegation) to read their availability
// and free/busy, and to land their bookings. This is the multi-employee model.

import { google } from 'googleapis'
import { getAuth } from '@/lib/google'
import type { Interval } from '@/lib/scheduling/slots'

// The minimal technician shape the reader needs (structurally satisfied by the
// data layer's TechnicianRow). Keeps scheduling decoupled from the data layer.
export type TechnicianCalendar = {
  calendarEmail: string // the @forgehandyman.com user to impersonate
  availabilityCalendarId: string // calendar holding "open for jobs" windows
}

export type TimeRange = { from: string; to: string } // ISO instants

function isoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

// The technician's bookable "open" windows in the range. Source: a dedicated
// availability calendar whose (timed) events each mark a window the tech is open
// for jobs — recurring events are expanded via singleEvents. Empty when no
// availability calendar is configured (the expected pre-setup state) or no open
// windows fall in the range.
//
// NOTE (Step 0): if Google's native "Working Hours" turns out to be readable via
// the API, swap this implementation — the interface (Interval[]) stays the same.
export async function getAvailabilityWindows(
  tech: TechnicianCalendar,
  range: TimeRange,
): Promise<Interval[]> {
  if (!tech.availabilityCalendarId) return []
  const auth = getAuth(tech.calendarEmail)
  const calendar = google.calendar({ version: 'v3', auth })
  const res = await calendar.events.list({
    calendarId: tech.availabilityCalendarId,
    timeMin: range.from,
    timeMax: range.to,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  })
  const windows: Interval[] = []
  for (const e of res.data.items ?? []) {
    // Timed events only — an all-day event is ambiguous as a bookable window.
    const start = isoToMs(e.start?.dateTime)
    const end = isoToMs(e.end?.dateTime)
    if (start != null && end != null && end > start) windows.push({ start, end })
  }
  return windows
}

// Auto-provision a technician's "Forge Availability" calendar so onboarding
// never involves hunting for a Calendar ID. Impersonates the new tech (DWD),
// creates a dedicated secondary calendar on their account, shares it back to
// BUSINESS_EMAIL (so the owner can manage their open windows), and returns the
// new calendar's id to store on the technician row.
export async function createAvailabilityCalendar(subject: string): Promise<string> {
  const auth = getAuth(subject)
  const calendar = google.calendar({ version: 'v3', auth })
  const created = await calendar.calendars.insert({
    requestBody: {
      summary: 'Forge Availability',
      description:
        'Open-for-jobs windows for self-scheduling. Events here = bookable time; ' +
        'your primary-calendar events automatically block conflicts.',
      timeZone: 'America/New_York',
    },
  })
  const calendarId = created.data.id
  if (!calendarId) throw new Error('createAvailabilityCalendar: no calendar id returned')

  // Share to the owner (best-effort — provisioning still succeeds if the grant
  // fails; the tech can share it manually).
  const businessEmail = process.env.BUSINESS_EMAIL
  if (businessEmail && businessEmail.toLowerCase() !== subject.trim().toLowerCase()) {
    try {
      await calendar.acl.insert({
        calendarId,
        requestBody: { role: 'writer', scope: { type: 'user', value: businessEmail } },
      })
    } catch {
      // non-fatal: owner can be granted access later
    }
  }
  return calendarId
}

// The technician's busy intervals in the range, via the free/busy API on their
// primary calendar. Returns opaque busy blocks only — never event titles or
// details (privacy: customers must not learn what David is doing).
export async function getBusyIntervals(
  tech: TechnicianCalendar,
  range: TimeRange,
): Promise<Interval[]> {
  const auth = getAuth(tech.calendarEmail)
  const calendar = google.calendar({ version: 'v3', auth })
  const res = await calendar.freebusy.query({
    requestBody: {
      timeMin: range.from,
      timeMax: range.to,
      items: [{ id: 'primary' }],
    },
  })
  const busy = res.data.calendars?.primary?.busy ?? []
  const intervals: Interval[] = []
  for (const b of busy) {
    const start = isoToMs(b.start)
    const end = isoToMs(b.end)
    if (start != null && end != null && end > start) intervals.push({ start, end })
  }
  return intervals
}
