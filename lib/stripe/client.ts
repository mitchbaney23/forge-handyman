import Stripe from 'stripe'

let stripeInstance: Stripe | null = null

export type StripeMode = 'live' | 'test'

export function getStripeMode(): StripeMode {
  return process.env.STRIPE_SECRET_KEY_LIVE ? 'live' : 'test'
}

export function getStripe(): Stripe {
  if (stripeInstance) return stripeInstance
  const liveKey = process.env.STRIPE_SECRET_KEY_LIVE
  const testKey = process.env.STRIPE_SECRET_KEY_TEST
  const key = liveKey ?? testKey
  if (!key) {
    throw new Error(
      'Either STRIPE_SECRET_KEY_LIVE or STRIPE_SECRET_KEY_TEST must be set',
    )
  }
  stripeInstance = new Stripe(key, {
    apiVersion: '2026-04-22.dahlia',
    typescript: true,
    appInfo: {
      name: 'forge-handyman',
      url: 'https://forgehandyman.com',
    },
    maxNetworkRetries: 2,
  })
  return stripeInstance
}

export function getWebhookSecret(): string {
  const liveSecret = process.env.STRIPE_WEBHOOK_SECRET_LIVE
  const testSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST
  const secret = getStripeMode() === 'live' ? liveSecret : testSecret
  if (!secret) {
    throw new Error(
      `Stripe webhook secret missing (mode=${getStripeMode()}). Set STRIPE_WEBHOOK_SECRET_${getStripeMode().toUpperCase()}.`,
    )
  }
  return secret
}

export function buildIdempotencyKey(scope: string, ...parts: string[]): string {
  return [scope, ...parts].filter(Boolean).join(':')
}
