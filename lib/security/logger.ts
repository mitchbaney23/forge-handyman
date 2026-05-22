import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

const REDACT_PATHS = [
  '*.phone',
  '*.email',
  '*.address',
  '*.name',
  '*.password',
  '*.token',
  '*.secret',
  '*.apiKey',
  '*.privateKey',
  '*.body',
  '*.cardNumber',
  '*.cvc',
  'phone',
  'email',
  'address',
  'name',
  'password',
  'token',
  'secret',
  'apiKey',
  'privateKey',
  'body',
  'cardNumber',
  'cvc',
]

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  base: { service: 'forge-handyman' },
  ...(isDev && process.env.NEXT_RUNTIME !== 'edge'
    ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }
    : {}),
})

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '[UNKNOWN]'
  const [local, domain] = email.split('@')
  if (!local || !domain) return '[INVALID_EMAIL]'
  return `${local[0]}***@${domain}`
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '[UNKNOWN]'
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '[INVALID_PHONE]'
  return `***${digits.slice(-4)}`
}
