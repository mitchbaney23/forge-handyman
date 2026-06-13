import { describe, expect, it } from 'vitest'
import { SHEET_HEADERS, type ContactRow, type SheetColumn } from '@/lib/sheet/repo'
import {
  isUuid,
  toContactRow,
  toDbInsert,
  toDbUpdate,
  type DbJob,
} from '@/lib/data/pg/mappers'

// Round-trips every mapper convention in BOTH directions. The parity contract
// (docs/stage-13-postgres-design.md "Mapper conventions"): pg output must be
// byte-identical to what the sheet layer produced, because queries.ts/pipeline
// compare ISO timestamps lexicographically and admin/cron code does
// `(v || '').trim().toLowerCase()` on raw cell strings.

const SAMPLE_UUID = '11111111-2222-4333-8444-555555555555'

// A DbJob with explicit values for every field. Helpers below override slices
// of it so each convention can be exercised in isolation.
function makeDbJob(overrides: Partial<DbJob> = {}): DbJob {
  return {
    id: SAMPLE_UUID,
    customer_id: '99999999-2222-4333-8444-555555555555',
    created_at: '2026-06-12T14:00:00.000Z',
    updated_at: '2026-06-12T14:00:00.000Z',
    submitted_at: '2026-06-12T14:03:22.123Z',
    name: 'Jane Doe',
    phone: '+19195551234',
    email: 'jane@example.com',
    address: '123 Main St',
    service_type: 'Repair',
    preferred_date: '2026-06-15',
    description: 'Fix the thing',
    referral_source: 'Google',
    status: 'New',
    complete_date: null,
    review_sent_at: null,
    review_send_count: null,
    review_received: false,
    seasonal_nudge_last_sent: null,
    opt_out: false,
    first_touch_sent_at: null,
    hours_to_first_touch: null,
    utm_source: '',
    stripe_customer_id: '',
    stripe_payment_method_id: '',
    deposit_paid_cents: null,
    balance_owed_cents: null,
    service_categories: [],
    property_type: '',
    urgency: '',
    best_contact_time: '',
    best_contact_method: '',
    photo_urls: [],
    is_returning_customer: false,
    prior_job_count: null,
    dispatch_status: '',
    dispatch_decision: '',
    dispatch_decided_at: null,
    telegram_message_id: '',
    legacy: null,
    anonymized_at: null,
    ...overrides,
  }
}

// A full ContactRow (every field set) for the toDbInsert direction.
function makeContactRow(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    submitted_at: '2026-06-12T14:03:22.123Z',
    name: 'Jane Doe',
    phone: '+19195551234',
    email: 'jane@example.com',
    address: '123 Main St',
    service_type: 'Repair',
    preferred_date: '2026-06-15',
    description: 'Fix the thing',
    referral_source: 'Google',
    status: 'New',
    complete_date: '',
    review_sent_at: '',
    review_send_count: '',
    review_received: '',
    seasonal_nudge_last_sent: '',
    opt_out: '',
    first_touch_sent_at: '',
    hours_to_first_touch: '',
    utm_source: '',
    job_id: SAMPLE_UUID,
    stripe_customer_id: '',
    stripe_payment_method_id: '',
    deposit_paid_cents: '',
    balance_owed_cents: '',
    service_categories: '',
    property_type: '',
    urgency: '',
    best_contact_time: '',
    best_contact_method: '',
    photo_urls: '',
    is_returning_customer: '',
    prior_job_count: '',
    dispatch_status: '',
    dispatch_decision: '',
    dispatch_decided_at: '',
    telegram_message_id: '',
    ...overrides,
  }
}

describe('isUuid', () => {
  it('accepts any-version UUIDs (v4 runtime, v5 migration-minted)', () => {
    expect(isUuid('11111111-2222-4333-8444-555555555555')).toBe(true)
    expect(isUuid('a1b2c3d4-e5f6-5789-9abc-def012345678')).toBe(true) // v5
    expect(isUuid('A1B2C3D4-E5F6-4789-8ABC-DEF012345678')).toBe(true) // upper
  })

  it('rejects non-UUID strings', () => {
    expect(isUuid('')).toBe(false)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('11111111-2222-4333-8444-55555555555')).toBe(false) // short
    expect(isUuid('11111111222243338444555555555555')).toBe(false) // no dashes
  })
})

describe('booleans: true ↔ "true", false ↔ ""', () => {
  it('reads true → "true" and false → ""', () => {
    const fromTrue = toContactRow(makeDbJob({ review_received: true, opt_out: true, is_returning_customer: true }))
    expect(fromTrue.review_received).toBe('true')
    expect(fromTrue.opt_out).toBe('true')
    expect(fromTrue.is_returning_customer).toBe('true')

    const fromFalse = toContactRow(makeDbJob({ review_received: false, opt_out: false, is_returning_customer: false }))
    expect(fromFalse.review_received).toBe('')
    expect(fromFalse.opt_out).toBe('')
    expect(fromFalse.is_returning_customer).toBe('')
  })

  it('writes "true" → true and "" → false', () => {
    const insTrue = toDbInsert(makeContactRow({ review_received: 'true', opt_out: 'true', is_returning_customer: 'true' }))
    expect(insTrue.review_received).toBe(true)
    expect(insTrue.opt_out).toBe(true)
    expect(insTrue.is_returning_customer).toBe(true)

    const insFalse = toDbInsert(makeContactRow({ review_received: '', opt_out: '', is_returning_customer: '' }))
    expect(insFalse.review_received).toBe(false)
    expect(insFalse.opt_out).toBe(false)
    expect(insFalse.is_returning_customer).toBe(false)
  })

  it('round-trips both boolean states', () => {
    for (const value of [true, false] as const) {
      const cell = toContactRow(makeDbJob({ opt_out: value })).opt_out
      const back = toDbInsert(makeContactRow({ opt_out: cell })).opt_out
      expect(back).toBe(value)
    }
  })
})

describe('numerics: NULL ↔ "", n ↔ String(n), incl. review_send_count/prior_job_count', () => {
  it('reads NULL → "" for every numeric column', () => {
    const row = toContactRow(
      makeDbJob({
        review_send_count: null,
        prior_job_count: null,
        deposit_paid_cents: null,
        balance_owed_cents: null,
      }),
    )
    expect(row.review_send_count).toBe('')
    expect(row.prior_job_count).toBe('')
    expect(row.deposit_paid_cents).toBe('')
    expect(row.balance_owed_cents).toBe('')
  })

  it('reads 7 → "7" for counts', () => {
    const row = toContactRow(makeDbJob({ review_send_count: 7, prior_job_count: 7 }))
    expect(row.review_send_count).toBe('7')
    expect(row.prior_job_count).toBe('7')
  })

  it('writes "" → null and "7" → 7 for counts', () => {
    const insNull = toDbInsert(makeContactRow({ review_send_count: '', prior_job_count: '' }))
    expect(insNull.review_send_count).toBeNull()
    expect(insNull.prior_job_count).toBeNull()

    const insSeven = toDbInsert(makeContactRow({ review_send_count: '7', prior_job_count: '7' }))
    expect(insSeven.review_send_count).toBe(7)
    expect(insSeven.prior_job_count).toBe(7)
  })

  it('round-trips NULL and 7 both directions', () => {
    for (const value of [null, 7] as const) {
      const cell = toContactRow(makeDbJob({ review_send_count: value })).review_send_count
      const back = toDbInsert(makeContactRow({ review_send_count: cell })).review_send_count
      expect(back).toBe(value)
    }
  })

  it('preserves "" ≠ "0" distinction for cents', () => {
    // '' is the sheet's "absent" — maps to NULL, NOT 0.
    const empty = toDbInsert(makeContactRow({ deposit_paid_cents: '' }))
    expect(empty.deposit_paid_cents).toBeNull()
    // '0' is a real zero — maps to 0, NOT NULL.
    const zero = toDbInsert(makeContactRow({ deposit_paid_cents: '0' }))
    expect(zero.deposit_paid_cents).toBe(0)
    expect(zero.deposit_paid_cents).not.toBeNull()

    // And the read side keeps them apart: NULL → '', 0 → '0'.
    expect(toContactRow(makeDbJob({ deposit_paid_cents: null })).deposit_paid_cents).toBe('')
    expect(toContactRow(makeDbJob({ deposit_paid_cents: 0 })).deposit_paid_cents).toBe('0')
  })

  it('throws on a non-integer numeric cell', () => {
    expect(() => toDbInsert(makeContactRow({ deposit_paid_cents: '12.5' }))).toThrow(/integer/)
    expect(() => toDbInsert(makeContactRow({ deposit_paid_cents: 'abc' }))).toThrow(/integer/)
  })
})

describe('timestamps: PostgREST format → canonical toISOString on output', () => {
  it('normalizes PostgREST microsecond/+00:00 format to the exact toISOString shape', () => {
    const row = toContactRow(
      makeDbJob({ submitted_at: '2026-06-12T14:03:22.123456+00:00' }),
    )
    expect(row.submitted_at).toBe('2026-06-12T14:03:22.123Z')
    // Byte-identical to what new Date().toISOString() produces — the property
    // lexicographic comparisons downstream depend on.
    expect(row.submitted_at).toBe(new Date('2026-06-12T14:03:22.123456+00:00').toISOString())
  })

  it('normalizes the space-separated PostgREST variant too', () => {
    const row = toContactRow(makeDbJob({ complete_date: '2026-06-12 14:03:22.123456+00:00' }))
    expect(row.complete_date).toBe('2026-06-12T14:03:22.123Z')
  })

  it('reads NULL timestamp → "" and writes "" → null', () => {
    expect(toContactRow(makeDbJob({ complete_date: null })).complete_date).toBe('')
    expect(toDbInsert(makeContactRow({ complete_date: '' })).complete_date).toBeNull()
  })

  it('passes an already-canonical timestamp through unchanged on write', () => {
    const ins = toDbInsert(makeContactRow({ submitted_at: '2026-06-12T14:03:22.123Z' }))
    expect(ins.submitted_at).toBe('2026-06-12T14:03:22.123Z')
  })

  it('round-trips an already-canonical timestamp', () => {
    const canonical = '2026-06-12T14:03:22.123Z'
    const cell = toContactRow(makeDbJob({ first_touch_sent_at: canonical })).first_touch_sent_at
    expect(cell).toBe(canonical)
    const back = toDbInsert(makeContactRow({ first_touch_sent_at: cell })).first_touch_sent_at
    expect(back).toBe(canonical)
  })
})

describe('preferred_date: NULL ↔ "", "YYYY-MM-DD" passthrough', () => {
  it('reads NULL → "" and a date string passthrough', () => {
    expect(toContactRow(makeDbJob({ preferred_date: null })).preferred_date).toBe('')
    expect(toContactRow(makeDbJob({ preferred_date: '2026-06-15' })).preferred_date).toBe('2026-06-15')
  })

  it('writes "" → null and "YYYY-MM-DD" passthrough', () => {
    expect(toDbInsert(makeContactRow({ preferred_date: '' })).preferred_date).toBeNull()
    expect(toDbInsert(makeContactRow({ preferred_date: '2026-06-15' })).preferred_date).toBe('2026-06-15')
  })

  it('round-trips both NULL and a date', () => {
    for (const dbValue of [null, '2026-06-15'] as const) {
      const cell = toContactRow(makeDbJob({ preferred_date: dbValue })).preferred_date
      const back = toDbInsert(makeContactRow({ preferred_date: cell })).preferred_date
      expect(back).toBe(dbValue)
    }
  })
})

describe('arrays: empty ↔ "", join/split', () => {
  it('reads {} → "" and [a,b] → "a,b"', () => {
    expect(toContactRow(makeDbJob({ service_categories: [] })).service_categories).toBe('')
    expect(toContactRow(makeDbJob({ service_categories: ['plumbing', 'electrical'] })).service_categories).toBe(
      'plumbing,electrical',
    )
    expect(toContactRow(makeDbJob({ photo_urls: ['a.jpg', 'b.jpg'] })).photo_urls).toBe('a.jpg,b.jpg')
  })

  it('writes "" → [] and "a,b" → [a,b]', () => {
    expect(toDbInsert(makeContactRow({ service_categories: '' })).service_categories).toEqual([])
    expect(toDbInsert(makeContactRow({ service_categories: 'plumbing,electrical' })).service_categories).toEqual([
      'plumbing',
      'electrical',
    ])
  })

  it('round-trips empty and multi-element arrays', () => {
    for (const dbValue of [[], ['a', 'b', 'c']] as string[][]) {
      const cell = toContactRow(makeDbJob({ photo_urls: dbValue })).photo_urls
      const back = toDbInsert(makeContactRow({ photo_urls: cell })).photo_urls
      expect(back).toEqual(dbValue)
    }
  })
})

describe('hours_to_first_touch is never emitted by toDbInsert/toDbUpdate', () => {
  it('toDbInsert never includes hours_to_first_touch', () => {
    const ins = toDbInsert(makeContactRow())
    expect('hours_to_first_touch' in ins).toBe(false)
  })

  it('toContactRow reads the generated column (read-only)', () => {
    const row = toContactRow(makeDbJob({ hours_to_first_touch: 3.5 }))
    expect(row.hours_to_first_touch).toBe('3.5')
    expect(toContactRow(makeDbJob({ hours_to_first_touch: null })).hours_to_first_touch).toBe('')
  })

  it('toDbUpdate silently drops hours_to_first_touch even if present', () => {
    const upd = toDbUpdate({ status: 'Booked', hours_to_first_touch: '99' })
    expect('hours_to_first_touch' in upd).toBe(false)
    expect(upd.status).toBe('Booked')
  })

  it('toDbUpdate of ONLY hours_to_first_touch yields an empty update', () => {
    const upd = toDbUpdate({ hours_to_first_touch: '99' })
    expect(Object.keys(upd)).toHaveLength(0)
  })
})

describe('toDbUpdate', () => {
  it('renames job_id → id', () => {
    const upd = toDbUpdate({ job_id: SAMPLE_UUID })
    expect(upd.id).toBe(SAMPLE_UUID)
  })

  it('maps undefined-as-cleared values to their cleared DB value (sheet parity)', () => {
    // The sheet cleared a cell when the partial carried an explicit undefined;
    // toDbUpdate iterates own keys, so an explicitly-undefined value maps to
    // the cleared DB value, not "skip".
    const upd = toDbUpdate({ complete_date: undefined, status: undefined })
    expect(upd.complete_date).toBeNull()
    expect(upd.status).toBe('')
  })

  it('throws on an unknown ContactRow field', () => {
    expect(() => toDbUpdate({ bogus: 'x' } as never)).toThrow(/unknown ContactRow field/)
  })
})

describe('no null/undefined ever appears in a mapped ContactRow', () => {
  it('every field is a string for a fully-NULL/empty DB row', () => {
    // The worst case for null leakage: every nullable column NULL, every
    // boolean false, every array empty.
    const row = toContactRow(
      makeDbJob({
        preferred_date: null,
        complete_date: null,
        review_sent_at: null,
        review_send_count: null,
        seasonal_nudge_last_sent: null,
        first_touch_sent_at: null,
        hours_to_first_touch: null,
        deposit_paid_cents: null,
        balance_owed_cents: null,
        prior_job_count: null,
        dispatch_decided_at: null,
        service_categories: [],
        photo_urls: [],
        anonymized_at: null,
        legacy: null,
      }),
    )
    for (const header of SHEET_HEADERS) {
      const value = (row as Record<SheetColumn, unknown>)[header]
      expect(typeof value, `field ${header}`).toBe('string')
      expect(value, `field ${header}`).not.toBeNull()
      expect(value, `field ${header}`).not.toBeUndefined()
    }
  })

  it('a fully-populated DB row also yields all strings', () => {
    const row = toContactRow(
      makeDbJob({
        preferred_date: '2026-06-15',
        complete_date: '2026-06-20T10:00:00.000Z',
        review_send_count: 2,
        deposit_paid_cents: 4500,
        balance_owed_cents: 0,
        prior_job_count: 3,
        service_categories: ['a', 'b'],
        photo_urls: ['x.jpg'],
        review_received: true,
        opt_out: true,
        is_returning_customer: true,
      }),
    )
    for (const header of SHEET_HEADERS) {
      expect(typeof (row as Record<SheetColumn, unknown>)[header], `field ${header}`).toBe('string')
    }
  })
})

describe('toDbInsert requires a UUID job_id', () => {
  it('throws on a non-UUID job_id', () => {
    expect(() => toDbInsert(makeContactRow({ job_id: 'not-a-uuid' }))).toThrow(/UUID job_id/)
  })

  it('renames job_id → id on insert', () => {
    expect(toDbInsert(makeContactRow({ job_id: SAMPLE_UUID })).id).toBe(SAMPLE_UUID)
  })

  it('trims and lowercases nothing but trims email at the write boundary', () => {
    const ins = toDbInsert(makeContactRow({ email: '  Jane@Example.com  ' }))
    expect(ins.email).toBe('Jane@Example.com') // trimmed, case preserved (citext handles case)
  })
})
