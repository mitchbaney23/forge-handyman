import * as Sentry from '@sentry/nextjs'

export async function register() {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return

  const commonConfig = {
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    enabled: process.env.NODE_ENV !== 'test',
    beforeSend(event: Sentry.ErrorEvent): Sentry.ErrorEvent | null {
      if (event.request) {
        if (event.request.cookies) event.request.cookies = '[REDACTED]' as unknown as Record<string, string>
        if (event.request.data) event.request.data = '[REDACTED]'
        if (event.request.headers) {
          const headers = event.request.headers as Record<string, string>
          for (const key of Object.keys(headers)) {
            const lower = key.toLowerCase()
            if (
              lower === 'authorization' ||
              lower === 'cookie' ||
              lower.startsWith('x-twilio') ||
              lower.startsWith('stripe-')
            ) {
              headers[key] = '[REDACTED]'
            }
          }
        }
      }
      if (event.user) {
        if (event.user.email) event.user.email = '[REDACTED]'
        if (event.user.username) event.user.username = '[REDACTED]'
        if (event.user.ip_address) event.user.ip_address = '[REDACTED]'
      }
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (/phone|email|address|name|password|token|secret|apikey|privatekey/i.test(key)) {
            event.extra[key] = '[REDACTED]'
          }
        }
      }
      return event
    },
    ignoreErrors: [
      'ZodError',
      'AbortError',
      'AbortSignal',
      'Network request failed',
    ],
  }

  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init(commonConfig)
  } else if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(commonConfig)
  }
}

export const onRequestError = Sentry.captureRequestError
