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

export type WebhookSource = 'stripe' | 'twilio' | 'make' | 'internal' | 'telegram'

export interface IdempotencyResult {
  isFirst: boolean
}

export async function checkAndMarkProcessed(
  source: WebhookSource,
  eventId: string,
): Promise<IdempotencyResult> {
  const r = getRedis()
  const key = `idemp:${source}:${eventId}`
  const result = await r.set(key, '1', { nx: true, ex: TTL_SECONDS })
  return { isFirst: result === 'OK' }
}
