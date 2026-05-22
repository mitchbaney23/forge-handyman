import { logger } from '@/lib/security/logger'

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileVerificationResult {
  success: boolean
  errorCodes: string[]
  hostname?: string
  action?: string
}

export async function verifyTurnstileToken(
  token: string | null | undefined,
  clientIp?: string,
): Promise<TurnstileVerificationResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('Turnstile secret missing in production — failing closed')
      return { success: false, errorCodes: ['config-missing'] }
    }
    logger.warn('TURNSTILE_SECRET_KEY missing — bypassing verification (dev only)')
    return { success: true, errorCodes: [] }
  }
  if (!token) {
    return { success: false, errorCodes: ['token-missing'] }
  }

  const body = new URLSearchParams({ secret, response: token })
  if (clientIp && clientIp !== 'unknown') body.set('remoteip', clientIp)

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!response.ok) {
      logger.warn({ status: response.status }, 'Turnstile siteverify non-2xx')
      return { success: false, errorCodes: ['siteverify-error'] }
    }
    const data = (await response.json()) as {
      success: boolean
      'error-codes'?: string[]
      hostname?: string
      action?: string
    }
    return {
      success: Boolean(data.success),
      errorCodes: data['error-codes'] ?? [],
      hostname: data.hostname,
      action: data.action,
    }
  } catch (err) {
    logger.error({ err }, 'Turnstile siteverify request failed')
    return { success: false, errorCodes: ['siteverify-network-error'] }
  }
}
