import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Stage 14 (Phase B1) activity timeline — lib/data/pg/activities-read.ts.
// Each assertion is a contract from docs/stage-14-crm-interface-design.md:
//  - listActivitiesForJob('garbage') returns [] WITHOUT a client call (the
//    uuid-typed .eq('job_id', ...) would throw 22P02 on a non-UUID; parity
//    with the repo's UUID gate).
//  - addJobNote inserts action='note.added' with job_id set to the jobId and
//    the actor/notes passed through (the one append B1 owns; the timeline
//    associates on activities.job_id, never the overloaded `target`).

const captured: {
  fromCalls: string[]
  inserted: { table: string; payload: unknown }[]
} = { fromCalls: [], inserted: [] }

// Result the next .range() terminal resolves (the listActivitiesForJob read).
let nextPage: { data: unknown[]; error: unknown } = { data: [], error: null }

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.order = () => builder
  builder.range = () => Promise.resolve(nextPage)
  // addJobNote awaits client.from('activities').insert({...}) directly (no
  // .select() chain), so .insert() returns a thenable resolving { error: null }.
  builder.insert = (payload: unknown) => {
    captured.inserted.push({ table, payload })
    return {
      then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
    }
  }
  return builder
}

vi.mock('@/lib/data/pg/client', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      captured.fromCalls.push(table)
      return makeBuilder(table)
    },
  }),
}))

vi.mock('@/lib/security/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  captured.fromCalls = []
  captured.inserted = []
  nextPage = { data: [], error: null }
})

afterEach(() => {
  vi.resetModules()
})

const UUID = '11111111-2222-4333-8444-555555555555'

describe('listActivitiesForJob: non-UUID short-circuits without a client call', () => {
  it("returns [] for 'garbage' WITHOUT calling the client", async () => {
    const { listActivitiesForJob } = await import('@/lib/data/pg/activities-read')
    const result = await listActivitiesForJob('garbage')
    expect(result).toEqual([])
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('returns [] for an empty jobId without a client call', async () => {
    const { listActivitiesForJob } = await import('@/lib/data/pg/activities-read')
    expect(await listActivitiesForJob('')).toEqual([])
    expect(captured.fromCalls).toHaveLength(0)
  })

  it('maps activities rows to the all-strings Activity (dates ISO, NULLs -> "", data passthrough)', async () => {
    nextPage = {
      data: [
        {
          id: 7,
          at: '2026-06-12 14:03:22.123456+00:00',
          actor: 'admin:mitch@example.com',
          action: 'note.added',
          target: null,
          before: null,
          after: null,
          notes: 'called the customer back',
          job_id: UUID,
          data: { source: 'admin' },
        },
      ],
      error: null,
    }
    const { listActivitiesForJob } = await import('@/lib/data/pg/activities-read')
    const [a] = await listActivitiesForJob(UUID)
    expect(captured.fromCalls).toEqual(['activities'])
    // id stringified, timestamp ISO-normalized.
    expect(a.id).toBe('7')
    expect(a.at).toBe('2026-06-12T14:03:22.123Z')
    // NULL free-text columns coerce to '' (no null on the boundary).
    expect(a.target).toBe('')
    expect(a.before).toBe('')
    expect(a.after).toBe('')
    expect(a.actor).toBe('admin:mitch@example.com')
    expect(a.notes).toBe('called the customer back')
    expect(a.jobId).toBe(UUID)
    // data is structured jsonb passthrough, not a boundary string.
    expect(a.data).toEqual({ source: 'admin' })
  })
})

describe("addJobNote: inserts action='note.added' with job_id set and actor/notes passed through", () => {
  it('writes the note.added action, the jobId in job_id, and the actor + notes', async () => {
    const { addJobNote } = await import('@/lib/data/pg/activities-read')
    const { ACTIONS } = await import('@/lib/data/activity-actions')

    const result = await addJobNote(UUID, 'admin:mitch@example.com', 'left a voicemail')
    expect(result).toEqual({ ok: true })

    expect(captured.inserted).toHaveLength(1)
    expect(captured.inserted[0].table).toBe('activities')
    const payload = captured.inserted[0].payload as Record<string, unknown>
    expect(payload.action).toBe(ACTIONS.NOTE_ADDED)
    expect(payload.action).toBe('note.added')
    // Timeline associates on job_id (NOT the overloaded `target`).
    expect(payload.job_id).toBe(UUID)
    // actor + notes pass through unchanged.
    expect(payload.actor).toBe('admin:mitch@example.com')
    expect(payload.notes).toBe('left a voicemail')
    // `at` is generated here (ISO), callers never supply a timestamp.
    expect(payload.at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
  })

  it("non-UUID jobId is a graceful no-op: { ok: false } WITHOUT an insert", async () => {
    const { addJobNote } = await import('@/lib/data/pg/activities-read')
    const result = await addJobNote('not-a-uuid', 'system', 'orphan note')
    expect(result).toEqual({ ok: false })
    expect(captured.fromCalls).toHaveLength(0)
    expect(captured.inserted).toHaveLength(0)
  })
})
