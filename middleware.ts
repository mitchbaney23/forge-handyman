import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

function buildCsp(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      'https://js.stripe.com',
      'https://challenges.cloudflare.com',
      'https://maps.googleapis.com',
      'https://maps.gstatic.com',
    ],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
    'connect-src': [
      "'self'",
      'https://api.stripe.com',
      'https://*.ingest.sentry.io',
      'https://*.ingest.us.sentry.io',
      'https://challenges.cloudflare.com',
      'https://maps.googleapis.com',
    ],
    'frame-src': [
      'https://js.stripe.com',
      'https://hooks.stripe.com',
      'https://challenges.cloudflare.com',
    ],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'upgrade-insecure-requests': [],
  }

  if (isDev) {
    directives['script-src'].push("'unsafe-eval'")
    directives['connect-src'].push('ws:', 'wss:')
  }

  return Object.entries(directives)
    .map(([key, values]) => (values.length === 0 ? key : `${key} ${values.join(' ')}`))
    .join('; ')
}

const ADMIN_PATH_PREFIX = '/admin'

function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PATH_PREFIX || pathname.startsWith(`${ADMIN_PATH_PREFIX}/`)
}

function parseAllowlist(): string[] {
  const raw = process.env.ADMIN_ALLOWLIST ?? ''
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl

  if (isAdminPath(pathname)) {
    const allowlist = parseAllowlist()
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })
    const email = typeof token?.email === 'string' ? token.email.toLowerCase() : null
    const isAuthorized = email !== null && allowlist.includes(email)
    if (!isAuthorized) {
      return NextResponse.rewrite(new URL('/not-found', req.url), { status: 404 })
    }
  }

  const isDev = process.env.NODE_ENV !== 'production'
  const csp = buildCsp(isDev)

  const response = NextResponse.next()

  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')

  return response
}

export const config = {
  matcher: [
    {
      source: '/((?!api/auth|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
    },
  ],
}
