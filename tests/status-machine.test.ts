import { describe, it, expect } from 'vitest'
import {
  ADMIN_STATUS_TRANSITIONS,
  canAdminTransition,
  statusOptionsFor,
} from '@/lib/jobs/status-machine'

// Phase B2 integrity guard for the admin status dropdown.
describe('admin status machine', () => {
  it("blocks hand-setting 'Complete' (would bypass markComplete's balance charge)", () => {
    expect(canAdminTransition('Booked', 'Complete')).toBe(false)
    expect(canAdminTransition('In Progress', 'Complete')).toBe(false)
    expect(canAdminTransition('New', 'Complete')).toBe(false)
  })

  it('allows a same-status no-op', () => {
    expect(canAdminTransition('Booked', 'Booked')).toBe(true)
    expect(canAdminTransition('Complete', 'Complete')).toBe(true)
  })

  it('allows normal forward moves', () => {
    expect(canAdminTransition('New', 'Quoted')).toBe(true)
    expect(canAdminTransition('Quoted', 'Booked')).toBe(true)
    expect(canAdminTransition('Booked', 'In Progress')).toBe(true)
  })

  it('blocks nonsense jumps', () => {
    expect(canAdminTransition('New', 'In Progress')).toBe(false)
    expect(canAdminTransition('Complete', 'New')).toBe(false)
  })

  it("no state offers a direct dropdown transition to 'Complete' (Principle #1)", () => {
    // Partial Refund previously leaked a Complete edge — closed in review.
    // (Complete->Complete is excluded: that's a same-status no-op, not a move.)
    for (const from of Object.keys(ADMIN_STATUS_TRANSITIONS)) {
      if (from === 'Complete') continue
      expect(canAdminTransition(from, 'Complete')).toBe(false)
    }
  })

  it('every terminal/error state has at least one escape edge (nothing wedges)', () => {
    for (const s of ['Payment Failed', 'Refunded', 'Partial Refund', 'Cancelled', 'Complete']) {
      expect((ADMIN_STATUS_TRANSITIONS[s] ?? []).length).toBeGreaterThan(0)
    }
  })

  it('statusOptionsFor lists the current status first, then allowed targets, never Complete for Booked', () => {
    const opts = statusOptionsFor('Booked')
    expect(opts[0]).toBe('Booked')
    expect(opts).not.toContain('Complete')
    expect(opts).toContain('In Progress')
    expect(opts).toContain('Cancelled')
  })
})
