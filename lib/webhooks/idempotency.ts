import { Redis } from '@upstash/redis'

let redisInstance: Redis | null = null

function getRedis(): Redis {
  if (redisInstance) return redisInstance
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set')
  }
  redisInstance = new Redis({ url, token })
  return redisInstance
}

const TTL_SECONDS = 24 * 60 * 60

// 'done' must OUTLIVE the provider's retry window or a late retry re-processes
// a finished event. Stripe retries for up to 3 days; 96h leaves margin so a
// boundary-jitter retry can never land after the marker expires.
const DONE_TTL_SECONDS = 96 * 60 * 60
// Crash backstop: if we die hard mid-handler (no catch runs), the claim expires
// and the provider's next retry gets through. Must comfortably exceed the
// function's max runtime.
const PROCESSING_TTL_SECONDS = 10 * 60

export type WebhookSource = 'stripe' | 'twilio' | 'make' | 'internal' | 'telegram'

export interface IdempotencyResult {
  isFirst: boolean
}

// Single-phase claim: marks the event processed the moment it's claimed, so a
// handler that throws AFTER this call permanently swallows the event. Only
// correct for sources whose route also swallows handler errors and never wants
// a retry (Telegram). Money-path sources must use the two-phase API below.
export async function checkAndMarkProcessed(
  source: WebhookSource,
  eventId: string,
): Promise<IdempotencyResult> {
  const r = getRedis()
  const key = `idemp:${source}:${eventId}`
  const result = await r.set(key, '1', { nx: true, ex: TTL_SECONDS })
  return { isFirst: result === 'OK' }
}

export type ProcessingClaim = 'first' | 'in_flight' | 'done'

function keyFor(source: WebhookSource, eventId: string): string {
  return `idemp:${source}:${eventId}`
}

// Two-phase claim for retry-backed webhooks: beginProcessing -> run handler ->
// markDone on success / releaseProcessing on failure. A failed handler releases
// the claim so the provider's retry re-processes instead of being deduped into
// the void.
export async function beginProcessing(
  source: WebhookSource,
  eventId: string,
): Promise<ProcessingClaim> {
  const r = getRedis()
  const claimed = await r.set(keyFor(source, eventId), 'processing', {
    nx: true,
    ex: PROCESSING_TTL_SECONDS,
  })
  if (claimed === 'OK') return 'first'
  const current = await r.get<string>(keyFor(source, eventId))
  if (current === 'processing') return 'in_flight'
  // null = the claim vanished between SET NX and GET (the winner failed and
  // released, or its TTL lapsed) — tell the provider to retry, don't dedupe.
  if (current === null) return 'in_flight'
  // 'done', or a legacy '1' written by checkAndMarkProcessed before this
  // two-phase scheme existed: already handled.
  return 'done'
}

export async function markDone(source: WebhookSource, eventId: string): Promise<void> {
  const r = getRedis()
  await r.set(keyFor(source, eventId), 'done', { ex: DONE_TTL_SECONDS })
}

// Best-effort by design: if the DEL itself fails, the 'processing' TTL expires
// shortly and the provider's retry still gets through.
export async function releaseProcessing(
  source: WebhookSource,
  eventId: string,
): Promise<void> {
  try {
    await getRedis().del(keyFor(source, eventId))
  } catch {
    // swallowed — see above
  }
}
