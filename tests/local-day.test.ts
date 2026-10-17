import { describe, it, expect } from 'vitest'
import { isSameLocalDay, toLocalIsoDate } from '@/lib/sheet/queries'

// Phase B2: Today/Tomorrow buckets on Eastern time, not UTC. The pre-B2 code
// used toISOString() so the dashboard rolled to "tomorrow" at UTC midnight
// (8pm ET in winter / 7pm in summer).
describe('isSameLocalDay — Eastern-time bucketing', () => {
  it('buckets a late-evening ET moment on the ET calendar day, not the UTC one', () => {
    // 2026-06-15T02:00:00Z === 2026-06-14 22:00 EDT
    const d = new Date('2026-06-15T02:00:00Z')
    expect(toLocalIsoDate(d)).toBe('2026-06-14')
    expect(isSameLocalDay('2026-06-14', d)).toBe(true)
    expect(isSameLocalDay('2026-06-15', d)).toBe(false)
  })

  it('matches when the ET date equals the preferred date', () => {
    // 2026-06-15T15:00:00Z === 2026-06-15 11:00 EDT
    const d = new Date('2026-06-15T15:00:00Z')
    expect(isSameLocalDay('2026-06-15', d)).toBe(true)
  })

  it('an empty preferred_date is never "today"', () => {
    expect(isSameLocalDay('', new Date('2026-06-15T02:00:00Z'))).toBe(false)
  })
})

describe('easternWallTimeToIso: an Eastern date + time to the UTC instant', () => {
  it('handles daylight and standard time', async () => {
    const { easternWallTimeToIso } = await import('@/lib/scheduling/time')
    expect(easternWallTimeToIso('2026-10-20', '10:00')).toBe('2026-10-20T14:00:00.000Z')
    expect(easternWallTimeToIso('2026-01-15', '09:30')).toBe('2026-01-15T14:30:00.000Z')
  })

  it('gets both sides of a DST change right', async () => {
    const { easternWallTimeToIso } = await import('@/lib/scheduling/time')
    expect(easternWallTimeToIso('2026-03-08', '03:00')).toBe('2026-03-08T07:00:00.000Z')
    expect(easternWallTimeToIso('2026-11-01', '02:00')).toBe('2026-11-01T07:00:00.000Z')
  })

  it('returns null for the skipped spring-forward hour and malformed input', async () => {
    const { easternWallTimeToIso } = await import('@/lib/scheduling/time')
    expect(easternWallTimeToIso('2026-03-08', '02:30')).toBeNull()
    expect(easternWallTimeToIso('2026-02-30', '10:00')).toBeNull()
    expect(easternWallTimeToIso('2026-10-20', '24:00')).toBeNull()
    expect(easternWallTimeToIso('10/20/2026', '10:00')).toBeNull()
  })
})
