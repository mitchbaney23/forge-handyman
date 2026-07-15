import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Admin gate (middleware.ts): signed-out /admin/* hits must redirect to
// /signin with the original path preserved in callbackUrl — the "Build Quote"
// links in lead emails outlive the 24h session, and a 404 there dead-ends the
// money path. Authorized sessions pass through with security headers.

const getTokenMock = vi.hoisted(() => vi.fn())
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

import { middleware } from '@/middleware'

function req(path: string): NextRequest {
  return new NextRequest(`https://forgehandyman.com${path}`)
}

beforeEach(() => {
  process.env.ADMIN_ALLOWLIST = 'admin@forgehandyman.com'
  getTokenMock.mockReset()
})

afterEach(() => {
  delete process.env.ADMIN_ALLOWLIST
})

describe('middleware admin gate', () => {
  it('redirects a signed-out /admin/quotes/<id> hit to /signin with callbackUrl', async () => {
    getTokenMock.mockResolvedValue(null)
    const res = await middleware(req('/admin/quotes/29afc097-69bb-42b0-8c01-8ba4dcffcc2b'))
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/signin')
    expect(location.searchParams.get('callbackUrl')).toBe(
      '/admin/quotes/29afc097-69bb-42b0-8c01-8ba4dcffcc2b',
    )
  })

  it('preserves the query string in callbackUrl', async () => {
    getTokenMock.mockResolvedValue(null)
    const res = await middleware(req('/admin/jobs/abc?tab=timeline'))
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.searchParams.get('callbackUrl')).toBe('/admin/jobs/abc?tab=timeline')
  })

  it('redirects a signed-in but non-allowlisted email', async () => {
    getTokenMock.mockResolvedValue({ email: 'stranger@example.com' })
    const res = await middleware(req('/admin'))
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/signin')
  })

  it('lets an allowlisted session through with security headers', async () => {
    getTokenMock.mockResolvedValue({ email: 'Admin@ForgeHandyman.com' })
    const res = await middleware(req('/admin/quotes/29afc097-69bb-42b0-8c01-8ba4dcffcc2b'))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
  })

  it('leaves non-admin paths alone (no auth check, headers still applied)', async () => {
    const res = await middleware(req('/services'))
    expect(res.status).toBe(200)
    expect(getTokenMock).not.toHaveBeenCalled()
    expect(res.headers.get('Content-Security-Policy')).toBeTruthy()
  })
})
