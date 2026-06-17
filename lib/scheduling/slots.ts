// The pure slot-availability algorithm. NO I/O — Google free/busy and the
// availability windows are read elsewhere (lib/scheduling/availability.ts) and
// passed in as absolute instants. That keeps this fully unit-testable and, since
// it operates on epoch milliseconds, inherently DST-correct (instants are
// unambiguous; Eastern time is only used to *label* a slot's day).

import { easternIsoDate } from './time'
import { DEFAULT_SCHEDULING_CONFIG, type SchedulingConfig } from './config'

const MS_PER_MIN = 60_000
const MS_PER_DAY = 86_400_000

// A half-open interval [start, end) in epoch milliseconds.
export type Interval = { start: number; end: number }

// One bookable slot, as ISO instants (what the client/calendar consume).
export type Slot = { startsAt: string; endsAt: string }

// Slots grouped by their Eastern calendar day.
export type DaySlots = { dayISO: string; slots: Slot[] }

export type ComputeSlotsArgs = {
  now: Date | number
  jobMinutes: number
  // The technician's open windows (absolute instants), from the calendar.
  availabilityWindows: Interval[]
  // Times the technician is unavailable: Google free/busy ∪ existing Forge
  // appointments (absolute instants).
  busyIntervals: Interval[]
  config?: SchedulingConfig
}

export type ComputeSlotsResult = {
  slotsByDay: DaySlots[]
  // True when there IS availability but no window is long enough to fit the job
  // (e.g. an 8h package against 5h Saturdays). The form routes these to the
  // "request a callback" fallback. Distinct from simply having no open slots.
  tooLongForWindow: boolean
}

// Safety cap so a wide-open calendar can't produce an enormous payload.
const MAX_SLOTS = 200

function toMs(t: Date | number): number {
  return typeof t === 'number' ? t : t.getTime()
}

// Sort + merge overlapping/adjacent intervals into a minimal disjoint set.
function mergeIntervals(intervals: Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start)
  const merged: Interval[] = []
  for (const cur of valid) {
    const last = merged[merged.length - 1]
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end)
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

// Does [start, end) overlap any of the (merged, sorted) busy intervals?
function overlapsBusy(start: number, end: number, busy: Interval[]): boolean {
  for (const b of busy) {
    if (b.start >= end) break // sorted: nothing later can overlap
    if (b.end > start) return true
  }
  return false
}

export function computeAvailableSlots(
  args: ComputeSlotsArgs,
): ComputeSlotsResult {
  const config = args.config ?? DEFAULT_SCHEDULING_CONFIG
  const nowMs = toMs(args.now)

  const jobMs = args.jobMinutes * MS_PER_MIN
  const bufferMs = config.travelBufferMin * MS_PER_MIN
  const stepMs = config.slotGranularityMin * MS_PER_MIN
  const earliestStart = nowMs + config.minLeadMin * MS_PER_MIN
  const horizonEnd = nowMs + config.bookingWindowDays * MS_PER_DAY

  // Unknown / non-positive duration can't be slotted — caller should route to
  // the callback fallback; report it as "too long" so the form does just that.
  if (!Number.isFinite(jobMs) || jobMs <= 0) {
    return { slotsByDay: [], tooLongForWindow: true }
  }

  const windows = mergeIntervals(args.availabilityWindows)
    // Clamp each window to the bookable horizon.
    .map((w) => ({ start: w.start, end: Math.min(w.end, horizonEnd) }))
    .filter((w) => w.end > w.start)

  const busy = mergeIntervals(args.busyIntervals)

  // "Too long" only makes sense when the tech actually has availability: there
  // are windows, but none is long enough for the job to finish inside one.
  const tooLongForWindow =
    windows.length > 0 && windows.every((w) => w.end - w.start < jobMs)

  const byDay = new Map<string, Slot[]>()
  let total = 0

  for (const w of windows) {
    if (total >= MAX_SLOTS) break
    // First candidate: the earliest grid-aligned start that is >= the window
    // start AND respects the minimum-lead cutoff.
    const lowerBound = Math.max(w.start, earliestStart)
    let start = Math.ceil(lowerBound / stepMs) * stepMs

    while (start + jobMs <= w.end) {
      if (start > horizonEnd) break
      const jobEnd = start + jobMs
      // The job plus its trailing travel/cleanup buffer must be clear of busy
      // time (the buffer may extend past the window's close — that's fine).
      if (!overlapsBusy(start, jobEnd + bufferMs, busy)) {
        const dayISO = easternIsoDate(new Date(start))
        const slot: Slot = {
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(jobEnd).toISOString(),
        }
        const list = byDay.get(dayISO)
        if (list) list.push(slot)
        else byDay.set(dayISO, [slot])
        total += 1
        if (total >= MAX_SLOTS) break
      }
      start += stepMs
    }
  }

  const slotsByDay: DaySlots[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dayISO, slots]) => ({ dayISO, slots }))

  return { slotsByDay, tooLongForWindow }
}
