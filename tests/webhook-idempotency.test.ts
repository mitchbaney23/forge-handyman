import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Two-phase webhook idempotency (lib/webhooks/idempotency.ts). The contract:
//  - beginProcessing claims with SET NX 'processing' (short TTL — the crash
//    backstop) and classifies a lost claim race conservatively: only a stored
//    'done' (or a legacy '1' from the single-phase scheme) dedupes; anything
//    ambiguous ('processing', vanished key) asks the provider to retry;
//  - markDone stores 'done' with a TTL that outlives Stripe's 3-day retries;
//  - releaseProcessing deletes the claim and swallows its own failures;
//  - checkAndMarkProcessed (single-phase, Telegram) keeps its old behavior.

const calls = {
  set: [] as unknown[][],
  get: [] as string[],
  del: [] as string[],
}
let setResult: string | null = 'OK'
let getResult: string | null = null
let delError: Error | null = null

vi.mock('@upstash/redis', () => ({
  Redis: class {
    set(...args: unknown[]) {
      calls.set.push(args)
      return Promise.resolve(setResult)
    }
    get(key: string) {
      calls.get.push(key)
      return Promise.resolve(getResult)
    }
    del(key: string) {
      calls.del.push(key)
      return delError ? Promise.reject(delError) : Promise.resolve(1)
    }
  },
}))

beforeEach(() => {
  calls.set = []
  calls.get = []
  calls.del = []
  setResult = 'OK'
  getResult = null
  delError = null
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io')
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('beginProcessing', () => {
  it("returns 'first' when the NX claim wins, storing 'processing' with the short TTL", async () => {
    const { beginProcessing } = await import('@/lib/webhooks/idempotency')
    const claim = await beginProcessing('stripe', 'evt_1')
    expect(claim).toBe('first')
    expect(calls.set).toHaveLength(1)
    const [key, value, opts] = calls.set[0] as [string, string, { nx: boolean; ex: number }]
    expect(key).toBe('idemp:stripe:evt_1')
    expect(value).toBe('processing')
    expect(opts.nx).toBe(true)
    expect(opts.ex).toBe(10 * 60)
    expect(calls.get).toHaveLength(0)
  })

  it("returns 'done' when the stored value is 'done'", async () => {
    setResult = null
    getResult = 'done'
    const { beginProcessing } = await import('@/lib/webhooks/idempotency')
    expect(await beginProcessing('stripe', 'evt_1')).toBe('done')
  })

  it("treats a legacy '1' (single-phase scheme) as done", async () => {
    setResult = null
    getResult = '1'
    const { beginProcessing } = await import('@/lib/webhooks/idempotency')
    expect(await beginProcessing('stripe', 'evt_1')).toBe('done')
  })

  it("returns 'in_flight' while another delivery holds the claim", async () => {
    setResult = null
    getResult = 'processing'
    const { beginProcessing } = await import('@/lib/webhooks/idempotency')
    expect(await beginProcessing('stripe', 'evt_1')).toBe('in_flight')
  })

  it("returns 'in_flight' (NOT done) when the claim vanished mid-race — the winner failed, the retry must process", async () => {
    setResult = null
    getResult = null
    const { beginProcessing } = await import('@/lib/webhooks/idempotency')
    expect(await beginProcessing('stripe', 'evt_1')).toBe('in_flight')
  })
})

describe('markDone', () => {
  it("stores 'done' with a TTL that outlives Stripe's 3-day retry window", async () => {
    const { markDone } = await import('@/lib/webhooks/idempotency')
    await markDone('stripe', 'evt_1')
    const [key, value, opts] = calls.set[0] as [string, string, { ex: number }]
    expect(key).toBe('idemp:stripe:evt_1')
    expect(value).toBe('done')
    expect(opts.ex).toBeGreaterThanOrEqual(72 * 60 * 60)
  })
})

describe('releaseProcessing', () => {
  it('deletes the claim key', async () => {
    const { releaseProcessing } = await import('@/lib/webhooks/idempotency')
    await releaseProcessing('stripe', 'evt_1')
    expect(calls.del).toEqual(['idemp:stripe:evt_1'])
  })

  it('swallows a failed DEL (the processing TTL is the backstop)', async () => {
    delError = new Error('redis down')
    const { releaseProcessing } = await import('@/lib/webhooks/idempotency')
    await expect(releaseProcessing('stripe', 'evt_1')).resolves.toBeUndefined()
  })
})

describe('checkAndMarkProcessed (single-phase, kept for Telegram)', () => {
  it('isFirst=true when the NX set wins', async () => {
    const { checkAndMarkProcessed } = await import('@/lib/webhooks/idempotency')
    expect(await checkAndMarkProcessed('telegram', '42')).toEqual({ isFirst: true })
  })

  it('isFirst=false on a duplicate', async () => {
    setResult = null
    const { checkAndMarkProcessed } = await import('@/lib/webhooks/idempotency')
    expect(await checkAndMarkProcessed('telegram', '42')).toEqual({ isFirst: false })
  })
})
