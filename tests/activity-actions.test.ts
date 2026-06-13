import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  ACTORS,
  CLAUDE,
  STRIPE_WEBHOOK,
  SYSTEM,
  adminActor,
  telegramActor,
} from '@/lib/data/activity-actions'

// Stage 14 (Phase B1) activity vocabulary — lib/data/activity-actions.ts.
// A pure module (no client), so no mock. Contracts from
// docs/stage-14-crm-interface-design.md ("B1 — activity foundation"):
//  - the actor helpers produce the expected namespaced/bare strings so call
//    sites stop hand-rolling prefixes;
//  - ACTIONS is a closed set that includes note.added (new in B1) and the
//    distinct nudge.sent / nudge.skipped (renamed/split from seasonal_nudge.*).

describe('ACTORS: helpers produce the expected actor strings', () => {
  it('adminActor namespaces the email under admin:', () => {
    expect(adminActor('mitch@example.com')).toBe('admin:mitch@example.com')
    // Re-exported off ACTORS as well as at top level — same function.
    expect(ACTORS.adminActor('mitch@example.com')).toBe('admin:mitch@example.com')
  })

  it('telegramActor namespaces who under telegram:', () => {
    expect(telegramActor('david')).toBe('telegram:david')
    expect(ACTORS.telegramActor('david')).toBe('telegram:david')
  })

  it('the bare non-human actors are the expected tokens', () => {
    expect(CLAUDE).toBe('claude')
    expect(SYSTEM).toBe('system')
    expect(STRIPE_WEBHOOK).toBe('stripe-webhook')
    // Same constants surfaced on ACTORS.
    expect(ACTORS.CLAUDE).toBe('claude')
    expect(ACTORS.SYSTEM).toBe('system')
    expect(ACTORS.STRIPE_WEBHOOK).toBe('stripe-webhook')
  })
})

describe('ACTIONS: the closed set carries the B1 vocabulary', () => {
  it('contains note.added (new B1 timeline note)', () => {
    expect(ACTIONS.NOTE_ADDED).toBe('note.added')
    expect(Object.values(ACTIONS)).toContain('note.added')
  })

  it('contains distinct nudge.sent and nudge.skipped', () => {
    expect(ACTIONS.NUDGE_SENT).toBe('nudge.sent')
    expect(ACTIONS.NUDGE_SKIPPED).toBe('nudge.skipped')
    expect(ACTIONS.NUDGE_SENT).not.toBe(ACTIONS.NUDGE_SKIPPED)
    const values = Object.values(ACTIONS)
    expect(values).toContain('nudge.sent')
    expect(values).toContain('nudge.skipped')
  })

  it('keeps the legacy seasonal_nudge.* strings so historical rows still resolve', () => {
    expect(ACTIONS.SEASONAL_NUDGE_SENT).toBe('seasonal_nudge.sent')
    expect(ACTIONS.SEASONAL_NUDGE_SKIPPED).toBe('seasonal_nudge.skipped')
  })
})
