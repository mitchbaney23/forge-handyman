import { describe, it, expect } from 'vitest'
import {
  computeAvailableSlots,
  type Interval,
  type Slot,
} from '@/lib/scheduling/slots'

// The algorithm is pure and works on absolute instants, so tests build windows
// as explicit UTC timestamps and inject `now`. June 2026 is EDT (UTC-4): 9:00 ET
// = 13:00Z. January 2026 is EST (UTC-5): 9:00 ET = 14:00Z. Default config:
// granularity 30m, trailing buffer 30m, min lead 120m, window 30 days.

const ms = (iso: string) => new Date(iso).getTime()
const win = (startIso: string, endIso: string): Interval => ({
  start: ms(startIso),
  end: ms(endIso),
})

// A 5-hour EDT Saturday window (9:00–14:00 ET on 2026-06-20).
const SAT_WINDOW = win('2026-06-20T13:00:00Z', '2026-06-20T18:00:00Z')
// Comfortably before that window, so min-lead never bites.
const NOW_BEFORE = new Date('2026-06-15T12:00:00Z')

function allSlots(result: { slotsByDay: { slots: Slot[] }[] }): Slot[] {
  return result.slotsByDay.flatMap((d) => d.slots)
}

describe('computeAvailableSlots', () => {
  it('fills a clear window with back-to-back grid-aligned slots', () => {
    const res = computeAvailableSlots({
      now: NOW_BEFORE,
      jobMinutes: 120,
      availabilityWindows: [SAT_WINDOW],
      busyIntervals: [],
    })
    expect(res.tooLongForWindow).toBe(false)
    expect(res.slotsByDay).toHaveLength(1)
    expect(res.slotsByDay[0].dayISO).toBe('2026-06-20')
    const slots = res.slotsByDay[0].slots
    // 13:00,13:30,…,16:00 (last start where start+2h <= 18:00) = 7 slots.
    expect(slots).toHaveLength(7)
    expect(slots[0].startsAt).toBe('2026-06-20T13:00:00.000Z')
    expect(slots[0].endsAt).toBe('2026-06-20T15:00:00.000Z')
    expect(slots[slots.length - 1].startsAt).toBe('2026-06-20T16:00:00.000Z')
  })

  it('excludes slots that collide with a busy block (incl. trailing buffer)', () => {
    const busy = [win('2026-06-20T15:00:00Z', '2026-06-20T16:00:00Z')]
    const res = computeAvailableSlots({
      now: NOW_BEFORE,
      jobMinutes: 60,
      availabilityWindows: [SAT_WINDOW],
      busyIntervals: busy,
    })
    const slots = allSlots(res)
    const starts = slots.map((s) => s.startsAt)
    // 13:00 & 13:30 clear (job+buffer ends by 15:00); 14:00–15:30 knocked out by
    // the busy block + buffer; 16:00,16:30,17:00 clear again.
    expect(starts).toContain('2026-06-20T13:30:00.000Z')
    expect(starts).not.toContain('2026-06-20T14:00:00.000Z')
    expect(starts).toContain('2026-06-20T16:00:00.000Z')
    expect(slots).toHaveLength(5)
    // No emitted job interval may overlap the busy block.
    for (const s of slots) {
      const overlap =
        ms(s.startsAt) < ms('2026-06-20T16:00:00Z') &&
        ms(s.endsAt) > ms('2026-06-20T15:00:00Z')
      expect(overlap).toBe(false)
    }
  })

  it('flags tooLongForWindow when no window can fit the job', () => {
    const res = computeAvailableSlots({
      now: NOW_BEFORE,
      jobMinutes: 480, // 8h Full-Day package vs a 5h Saturday
      availabilityWindows: [SAT_WINDOW],
      busyIntervals: [],
    })
    expect(res.tooLongForWindow).toBe(true)
    expect(allSlots(res)).toHaveLength(0)
  })

  it('allows same-day booking but respects the minimum lead time', () => {
    const res = computeAvailableSlots({
      now: new Date('2026-06-20T13:10:00Z'), // 9:10 ET, inside the window
      jobMinutes: 60,
      availabilityWindows: [SAT_WINDOW],
      busyIntervals: [],
    })
    const slots = allSlots(res)
    // earliestStart = 13:10 + 2h = 15:10 → first grid start is 15:30.
    expect(slots[0].startsAt).toBe('2026-06-20T15:30:00.000Z')
    for (const s of slots) {
      expect(ms(s.startsAt)).toBeGreaterThanOrEqual(ms('2026-06-20T15:10:00Z'))
    }
  })

  it('excludes windows beyond the booking horizon', () => {
    const farWindow = win('2026-07-25T13:00:00Z', '2026-07-25T18:00:00Z') // 40d out
    const res = computeAvailableSlots({
      now: NOW_BEFORE, // horizon = 2026-07-15
      jobMinutes: 60,
      availabilityWindows: [SAT_WINDOW, farWindow],
      busyIntervals: [],
    })
    const days = res.slotsByDay.map((d) => d.dayISO)
    expect(days).toEqual(['2026-06-20'])
  })

  it('buckets to the correct Eastern day in winter (EST offset)', () => {
    // 9:00–11:00 EST on 2026-01-17 = 14:00–16:00Z.
    const res = computeAvailableSlots({
      now: new Date('2026-01-10T12:00:00Z'),
      jobMinutes: 60,
      availabilityWindows: [win('2026-01-17T14:00:00Z', '2026-01-17T16:00:00Z')],
      busyIntervals: [],
    })
    expect(res.slotsByDay).toHaveLength(1)
    expect(res.slotsByDay[0].dayISO).toBe('2026-01-17')
    // 14:00,14:30,15:00 (start+1h <= 16:00) = 3 slots.
    expect(res.slotsByDay[0].slots).toHaveLength(3)
  })

  it('merges overlapping availability windows without duplicating slots', () => {
    const res = computeAvailableSlots({
      now: NOW_BEFORE,
      jobMinutes: 60,
      availabilityWindows: [
        win('2026-06-20T13:00:00Z', '2026-06-20T16:00:00Z'),
        win('2026-06-20T15:00:00Z', '2026-06-20T18:00:00Z'), // overlaps
      ],
      busyIntervals: [],
    })
    const starts = allSlots(res).map((s) => s.startsAt)
    // Merged window 13:00–18:00 → 13:00..17:00 step 30 with 1h job = 9 slots.
    expect(starts).toHaveLength(9)
    expect(new Set(starts).size).toBe(9) // no duplicates across the overlap
  })
})
