import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Stripe webhook route two-phase idempotency (app/api/webhooks/stripe/route.ts).
// The contract that fixes the lost-event bug:
//  - 'done' claim  -> 200 dedupe, handler never runs;
//  - 'in_flight'   -> 500 (Stripe retries later), handler never runs;
//  - 'first' + handler success -> markDone, 200;
//  - 'first' + handler THROW   -> releaseProcessing (so Stripe's retry
//    re-processes instead of being deduped into the void), 500;
//  - markDone failure after success -> still 200 (work is done; never invite
//    a retry of completed side effects).

const captured = {
  begins: [] as string[],
  dones: [] as string[],
  releases: [] as string[],
  dispatched: [] as string[],
}
let claimResult: 'first' | 'in_flight' | 'done' = 'first'
let handlerError: Error | null = null
let markDoneError: Error | null = null

vi.mock('@/lib/webhooks/idempotency', () => ({
  beginProcessing: (_source: string, eventId: string) => {
    captured.begins.push(eventId)
    return Promise.resolve(claimResult)
  },
  markDone: (_source: string, eventId: string) => {
    captured.dones.push(eventId)
    return markDoneError ? Promise.reject(markDoneError) : Promise.resolve()
  },
  releaseProcessing: (_source: string, eventId: string) => {
    captured.releases.push(eventId)
    return Promise.resolve()
  },
}))
vi.mock('@/lib/stripe/client', () => ({
  getStripe: () => ({
    webhooks: {
      constructEvent: () => ({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } }),
    },
  }),
  getWebhookSecret: () => 'whsec_test',
}))
vi.mock('@/lib/stripe/webhook-handlers', () => ({
  handleCheckoutSessionCompleted: () => {
    captured.dispatched.push('checkout.session.completed')
    return handlerError ? Promise.reject(handlerError) : Promise.resolve()
  },
  handlePaymentIntentSucceeded: () => Promise.resolve(),
  handlePaymentIntentFailed: () => Promise.resolve(),
  handleCustomerCreated: () => Promise.resolve(),
  handleChargeRefunded: () => Promise.resolve(),
}))
vi.mock('@sentry/nextjs', () => ({
  captureException: () => undefined,
  captureMessage: () => undefined,
}))
vi.mock('@/lib/security/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}))

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': 'sig' },
    body: '{}',
  })
}

beforeEach(() => {
  captured.begins = []
  captured.dones = []
  captured.releases = []
  captured.dispatched = []
  claimResult = 'first'
  handlerError = null
  markDoneError = null
})
afterEach(() => vi.resetModules())

describe('POST /api/webhooks/stripe', () => {
  it('dedupes a done event with 200 and never dispatches', async () => {
    claimResult = 'done'
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true, deduped: true })
    expect(captured.dispatched).toHaveLength(0)
  })

  it('returns 500 for an in-flight duplicate so Stripe retries later', async () => {
    claimResult = 'in_flight'
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(captured.dispatched).toHaveLength(0)
    expect(captured.releases).toHaveLength(0)
  })

  it('marks done after a successful handler and returns 200', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(captured.dispatched).toEqual(['checkout.session.completed'])
    expect(captured.dones).toEqual(['evt_1'])
    expect(captured.releases).toHaveLength(0)
  })

  it('RELEASES the claim when the handler throws — the retry must re-process, not dedupe', async () => {
    handlerError = new Error('db blip')
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeRequest())
    expect(res.status).toBe(500)
    expect(captured.releases).toEqual(['evt_1'])
    expect(captured.dones).toHaveLength(0)
  })

  it('still returns 200 when markDone fails after successful handling', async () => {
    markDoneError = new Error('redis blip')
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    expect(captured.dispatched).toEqual(['checkout.session.completed'])
  })
})
