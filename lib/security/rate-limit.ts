import { Ratelimit } from '@upstash/ratelimit'
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

export type LimiterName =
  | 'contact-form-hour'
  | 'contact-form-day'
  | 'admin-login'
  | 'admin-action'
  | 'webhook-source'
  | 'public-api'
  | 'photo-upload'
  | 'telegram-webhook'

const limiterCache: Partial<Record<LimiterName, Ratelimit>> = {}

function buildLimiter(name: LimiterName): Ratelimit {
  const redis = getRedis()
  switch (name) {
    case 'contact-form-hour':
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '1 h'), prefix: 'rl:contact-h', analytics: true })
    case 'contact-form-day':
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(20, '1 d'), prefix: 'rl:contact-d', analytics: true })
    case 'admin-login':
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '15 m'), prefix: 'rl:admin-login', analytics: true })
    case 'admin-action':
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '1 m'), prefix: 'rl:admin-action', analytics: true })
    case 'webhook-source':
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, '1 m'), prefix: 'rl:webhook', analytics: true })
    case 'public-api':
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '1 m'), prefix: 'rl:public', analytics: true })
    case 'photo-upload':
      // 30 photo uploads per 15 min per IP — comfortably covers 5 form
      // submissions with the full 6-photo loadout, plus testing headroom.
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(30, '15 m'), prefix: 'rl:photo', analytics: true })
    case 'telegram-webhook':
      // Telegram callback volume is tiny (David tapping buttons); a generous
      // cap that still stops a runaway loop if Telegram retries aggressively.
      return new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(60, '1 m'), prefix: 'rl:tg', analytics: true })
  }
}

function getLimiter(name: LimiterName): Ratelimit {
  const existing = limiterCache[name]
  if (existing) return existing
  const created = buildLimiter(name)
  limiterCache[name] = created
  return created
}

export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  resetAt: number
  retryAfterSeconds: number
}

export async function checkLimit(name: LimiterName, identifier: string): Promise<RateLimitResult> {
  const limiter = getLimiter(name)
  const result = await limiter.limit(identifier)
  return {
    success: result.success,
    limit: result.limit,
    remaining: result.remaining,
    resetAt: result.reset,
    retryAfterSeconds: Math.max(0, Math.ceil((result.reset - Date.now()) / 1000)),
  }
}

export function extractIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xrip = req.headers.get('x-real-ip')
  if (xrip) return xrip.trim()
  return 'unknown'
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.success ? {} : { 'Retry-After': String(result.retryAfterSeconds) }),
  }
}
