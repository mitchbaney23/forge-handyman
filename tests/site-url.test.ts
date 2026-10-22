import { describe, expect, it } from 'vitest'
import { resolveSiteUrl } from '@/lib/constants'

// lib/constants.ts resolveSiteUrl: the address every public page names as its
// official one. What is pinned: forgehandyman.com wins unless the env var holds
// a real, non-Vercel URL, and stray whitespace or trailing slashes never leak
// into canonical tags or the sitemap.

describe('resolveSiteUrl', () => {
  it('falls back to forgehandyman.com when unset or blank', () => {
    expect(resolveSiteUrl(undefined)).toBe('https://forgehandyman.com')
    expect(resolveSiteUrl('')).toBe('https://forgehandyman.com')
    expect(resolveSiteUrl('  \n')).toBe('https://forgehandyman.com')
  })

  it('ignores the old vercel.app test address, even with a trailing newline', () => {
    expect(resolveSiteUrl('https://forge-handyman.vercel.app\n')).toBe('https://forgehandyman.com')
    expect(resolveSiteUrl('https://forge-handyman-abc123-team.vercel.app')).toBe('https://forgehandyman.com')
  })

  it('ignores a value that is not a URL', () => {
    expect(resolveSiteUrl('forgehandyman.com')).toBe('https://forgehandyman.com')
  })

  it('keeps a real address, trimmed and without a trailing slash', () => {
    expect(resolveSiteUrl('https://forgehandyman.com/\n')).toBe('https://forgehandyman.com')
    expect(resolveSiteUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })
})
