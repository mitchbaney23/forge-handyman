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
