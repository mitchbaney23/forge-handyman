import { describe, expect, it } from 'vitest'
import type { SheetColumn } from '@/lib/sheet/repo'
import {
  buildMigrationPlan,
  deterministicJobId,
  normalizePhone,
  normalizePreferredDate,
  parseSheetBoolean,
  parseSheetCents,
  rawCellsFromContactRow,
  REDACTED_SENTINEL,
  uuidv5,
  type RawSheetRow,
} from '@/scripts/migration-helpers'

// Fixtures for the FORMATTED_VALUE parsers and the migration plan builder
// (docs/stage-13-postgres-design.md "Migration script"). The parsers normalize
// Google Sheets coercion artifacts; the plan builder groups customers, dedupes
// duplicate job_ids, and mints stable UUIDs.

const NOW_ISO = '2026-06-12T00:00:00.000Z'

// Build a RawSheetRow with the given overrides; all 36 cells default to ''.
function rawRow(rowNumber: number, cells: Partial<Record<SheetColumn, string>>): RawSheetRow {
  return { rowNumber, cells: rawCellsFromContactRow(cells) }
}

describe('parseSheetBoolean', () => {
  it("'TRUE' (Sheets-coerced) → true", () => {
    expect(parseSheetBoolean('TRUE').value).toBe(true)
  })

  it("'True ' (mixed case + trailing space) → true", () => {
    expect(parseSheetBoolean('True ').value).toBe(true)
  })

  it("'' → false with no issue", () => {
    const r = parseSheetBoolean('')
    expect(r.value).toBe(false)
    expect(r.issue).toBeUndefined()
  })

  it("'yes' → false WITH a reported issue", () => {
    const r = parseSheetBoolean('yes')
    expect(r.value).toBe(false)
    expect(r.issue).toBeDefined()
  })
})

describe('parseSheetCents', () => {
  it("'4,500' (thousands separator stripped) → 4500", () => {
    expect(parseSheetCents('4,500').value).toBe(4500)
  })

  it("'abc' → null WITH a reported issue", () => {
    const r = parseSheetCents('abc')
    expect(r.value).toBeNull()
    expect(r.issue).toBeDefined()
  })

  it("'' → null (sheet's absent, not 0)", () => {
    expect(parseSheetCents('').value).toBeNull()
  })

  it("'0' → 0 (real zero, distinct from absent)", () => {
    expect(parseSheetCents('0').value).toBe(0)
  })

  it('rejects a value above the int4 ceiling BEFORE it can overflow mid-INSERT', () => {
    const r = parseSheetCents('9999999999') // < 2^53 (safe int) but > int4 max
    expect(r.value).toBeNull()
    expect(r.issue).toMatch(/int4/)
  })

  it("int4 max (2,147,483,647) still passes", () => {
    expect(parseSheetCents('2147483647').value).toBe(2147483647)
  })
})

describe('normalizePhone', () => {
  it("'+19195551234' (E.164) passthrough", () => {
    const r = normalizePhone('+19195551234')
    expect(r.value).toBe('+19195551234')
    expect(r.issue).toBeUndefined()
  })

  it("'19195551234' (11-digit leading 1, '+' eaten by Sheets) → '+19195551234'", () => {
    expect(normalizePhone('19195551234').value).toBe('+19195551234')
  })

  it("'9195551234' (10-digit) → '+19195551234'", () => {
    expect(normalizePhone('9195551234').value).toBe('+19195551234')
  })

  it("'555-1234' kept as-is AND reported", () => {
    const r = normalizePhone('555-1234')
    expect(r.value).toBe('555-1234')
    expect(r.issue).toBeDefined()
  })
})

describe('normalizePreferredDate', () => {
  it("'6/15/2026' (Sheets M/D/YYYY) → '2026-06-15'", () => {
    const r = normalizePreferredDate('6/15/2026')
    expect(r.value).toBe('2026-06-15')
    expect(r.issue).toBeUndefined()
  })

  it("'2026-06-15' (ISO) passthrough", () => {
    expect(normalizePreferredDate('2026-06-15').value).toBe('2026-06-15')
  })

  it("'' → null", () => {
    expect(normalizePreferredDate('').value).toBeNull()
  })

  it("garbage → null WITH a reported issue", () => {
    const r = normalizePreferredDate('next tuesday')
    expect(r.value).toBeNull()
    expect(r.issue).toBeDefined()
  })
})

describe('UUIDv5 determinism', () => {
  it('same inputs → same UUID twice', () => {
    const a = deterministicJobId(5, '2026-06-12T14:03:22.123Z', 'jane@example.com')
    const b = deterministicJobId(5, '2026-06-12T14:03:22.123Z', 'jane@example.com')
    expect(a).toBe(b)
  })

  it('different inputs → different UUIDs', () => {
    const a = deterministicJobId(5, '2026-06-12T14:03:22.123Z', 'jane@example.com')
    const c = deterministicJobId(6, '2026-06-12T14:03:22.123Z', 'jane@example.com')
    expect(a).not.toBe(c)
  })

  it('produces a valid v5 UUID (version nibble = 5, RFC 4122 variant)', () => {
    const id = uuidv5('anything', '7c0884d7-ee41-4e9f-b8c2-1d6e3a5f9b04')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('buildMigrationPlan: customer grouping', () => {
  it('dedupes same-email-different-case into one customer', () => {
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '2026-06-10T10:00:00.000Z',
          email: 'Jane@Example.com',
          name: 'Jane',
          phone: '+19195551111',
          status: 'New',
          job_id: '11111111-2222-4333-8444-555555555555',
        }),
        rawRow(3, {
          submitted_at: '2026-06-11T10:00:00.000Z',
          email: 'jane@example.COM',
          name: 'Jane Doe',
          phone: '+19195552222',
          status: 'New',
          job_id: '22222222-2222-4333-8444-555555555555',
        }),
      ],
      NOW_ISO,
    )
    expect(plan.ok).toBe(true)
    expect(plan.customers).toHaveLength(1)
    expect(plan.jobs).toHaveLength(2)
    // Both jobs reference the single grouped customer.
    expect(new Set(plan.jobs.map((j) => j.customer_id)).size).toBe(1)
    expect(plan.customers[0].email).toBe('jane@example.com') // lower(trim(email))
  })

  it('newest-wins for name/phone within a group', () => {
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '2026-06-10T10:00:00.000Z',
          email: 'jane@example.com',
          name: 'Old Name',
          phone: '+19195551111',
          status: 'New',
          job_id: '11111111-2222-4333-8444-555555555555',
        }),
        rawRow(3, {
          submitted_at: '2026-06-12T10:00:00.000Z',
          email: 'jane@example.com',
          name: 'New Name',
          phone: '+19195552222',
          status: 'New',
          job_id: '22222222-2222-4333-8444-555555555555',
        }),
      ],
      NOW_ISO,
    )
    expect(plan.customers).toHaveLength(1)
    expect(plan.customers[0].name).toBe('New Name')
    expect(plan.customers[0].phone).toBe('+19195552222')
  })

  it('newest row with an EMPTY name does not clobber an older non-empty name', () => {
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '2026-06-10T10:00:00.000Z',
          email: 'jane@example.com',
          name: 'Has Name',
          phone: '+19195551111',
          status: 'New',
          job_id: '11111111-2222-4333-8444-555555555555',
        }),
        rawRow(3, {
          submitted_at: '2026-06-12T10:00:00.000Z',
          email: 'jane@example.com',
          name: '', // newest but empty — must not overwrite
          phone: '',
          status: 'New',
          job_id: '22222222-2222-4333-8444-555555555555',
        }),
      ],
      NOW_ISO,
    )
    expect(plan.customers[0].name).toBe('Has Name')
    expect(plan.customers[0].phone).toBe('+19195551111')
  })

  it("'[REDACTED]' email → per-row sentinel customer with anonymized_at set", () => {
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '2026-06-10T10:00:00.000Z',
          email: REDACTED_SENTINEL,
          name: REDACTED_SENTINEL,
          phone: REDACTED_SENTINEL,
          status: 'Complete',
          job_id: '11111111-2222-4333-8444-555555555555',
        }),
        rawRow(3, {
          submitted_at: '2026-06-11T10:00:00.000Z',
          email: REDACTED_SENTINEL,
          name: REDACTED_SENTINEL,
          phone: REDACTED_SENTINEL,
          status: 'Complete',
          job_id: '22222222-2222-4333-8444-555555555555',
        }),
      ],
      NOW_ISO,
    )
    expect(plan.ok).toBe(true)
    // Per-row (NOT grouped): two redacted rows → two customers.
    expect(plan.customers).toHaveLength(2)
    for (const customer of plan.customers) {
      expect(customer.email).toMatch(/^redacted:/)
      expect(customer.anonymized_at).toBe(NOW_ISO)
    }
    // jobs.anonymized_at backfilled for redacted rows.
    for (const job of plan.jobs) {
      expect(job.anonymized_at).toBe(NOW_ISO)
    }
  })

  it("'' empty email → per-row 'unknown:' sentinel customer, NOT anonymized", () => {
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '2026-06-10T10:00:00.000Z',
          email: '',
          name: 'No Email A',
          status: 'New',
          job_id: '11111111-2222-4333-8444-555555555555',
        }),
        rawRow(3, {
          submitted_at: '2026-06-11T10:00:00.000Z',
          email: '',
          name: 'No Email B',
          status: 'New',
          job_id: '22222222-2222-4333-8444-555555555555',
        }),
      ],
      NOW_ISO,
    )
    expect(plan.customers).toHaveLength(2) // per-row, never collapsed
    for (const customer of plan.customers) {
      expect(customer.email).toMatch(/^unknown:/)
      expect(customer.anonymized_at).toBeNull()
    }
    expect(plan.jobs.every((j) => j.anonymized_at === null)).toBe(true)
  })
})

describe('buildMigrationPlan: duplicate job_id keep-first', () => {
  it('keeps the FIRST occurrence and stashes legacy duplicates', () => {
    const dupId = '11111111-2222-4333-8444-555555555555'
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '2026-06-10T10:00:00.000Z',
          email: 'a@example.com',
          name: 'First',
          status: 'New',
          job_id: dupId,
        }),
        rawRow(3, {
          submitted_at: '2026-06-11T10:00:00.000Z',
          email: 'a@example.com',
          name: 'Second (dupe)',
          status: 'Booked',
          job_id: dupId,
        }),
      ],
      NOW_ISO,
    )
    expect(plan.ok).toBe(true)
    // Only one job written for the duplicated id.
    const dupeJobs = plan.jobs.filter((j) => j.id === dupId)
    expect(dupeJobs).toHaveLength(1)
    // The KEPT one is the first row.
    expect(dupeJobs[0].name).toBe('First')
    expect(dupeJobs[0].legacy.rowNumber).toBe(2)
    // The discarded duplicate is stashed raw in legacy.duplicates.
    expect(dupeJobs[0].legacy.duplicates).toHaveLength(1)
    expect(dupeJobs[0].legacy.duplicates?.[0].rowNumber).toBe(3)
    // And reported prominently.
    expect(plan.duplicateJobIds).toHaveLength(1)
    expect(plan.duplicateJobIds[0]).toMatchObject({
      jobId: dupId,
      keptRowNumber: 2,
      discardedRowNumbers: [3],
    })
  })
})

describe('buildMigrationPlan: minted ids for missing/invalid job_id', () => {
  it('mints a deterministic UUIDv5 for an empty job_id', () => {
    const rows = [
      rawRow(2, {
        submitted_at: '2026-06-10T10:00:00.000Z',
        email: 'a@example.com',
        status: 'New',
        job_id: '',
      }),
    ]
    const a = buildMigrationPlan(rows, NOW_ISO)
    const b = buildMigrationPlan(rows, NOW_ISO)
    // Stable across runs (the --verify safety property).
    expect(a.jobs[0].id).toBe(b.jobs[0].id)
    expect(a.mintedJobIds).toHaveLength(1)
    expect(a.mintedJobIds[0].rowNumber).toBe(2)
    expect(a.mintedJobIds[0].invalidValue).toBeUndefined()
  })

  it('mints and reports the invalid value for a non-UUID job_id', () => {
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '2026-06-10T10:00:00.000Z',
          email: 'a@example.com',
          status: 'New',
          job_id: 'garbage-id',
        }),
      ],
      NOW_ISO,
    )
    expect(plan.mintedJobIds[0].invalidValue).toBe('garbage-id')
    expect(plan.jobs[0].legacy.invalidJobId).toBe('garbage-id')
  })
})

describe('buildMigrationPlan: validation', () => {
  it('excludes a row with empty submitted_at and sets ok=false', () => {
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '', // NOT NULL in jobs — fatal
          email: 'a@example.com',
          status: 'New',
          job_id: '11111111-2222-4333-8444-555555555555',
        }),
      ],
      NOW_ISO,
    )
    expect(plan.ok).toBe(false)
    expect(plan.excludedRowNumbers).toContain(2)
    expect(plan.jobs).toHaveLength(0)
  })

  it('fails on an unknown status', () => {
    const plan = buildMigrationPlan(
      [
        rawRow(2, {
          submitted_at: '2026-06-10T10:00:00.000Z',
          email: 'a@example.com',
          status: 'Bogus Status',
          job_id: '11111111-2222-4333-8444-555555555555',
        }),
      ],
      NOW_ISO,
    )
    expect(plan.ok).toBe(false)
    expect(plan.issues.some((i) => i.severity === 'error' && i.field === 'status')).toBe(true)
  })
})
