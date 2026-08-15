import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getNotificationRecipients, getNotificationTo } from '@/lib/email/recipients'

const ORIGINAL = { ...process.env }

beforeEach(() => {
  delete process.env.NOTIFICATION_EMAILS
  delete process.env.BUSINESS_EMAIL
})

afterEach(() => {
  process.env = { ...ORIGINAL }
})

describe('getNotificationRecipients', () => {
  it('falls back to BUSINESS_EMAIL when NOTIFICATION_EMAILS is unset', () => {
    process.env.BUSINESS_EMAIL = 'admin@forgehandyman.com'
    expect(getNotificationRecipients()).toEqual(['admin@forgehandyman.com'])
  })

  it('falls back when NOTIFICATION_EMAILS is set but blank', () => {
    process.env.NOTIFICATION_EMAILS = '   '
    process.env.BUSINESS_EMAIL = 'admin@forgehandyman.com'
    expect(getNotificationRecipients()).toEqual(['admin@forgehandyman.com'])
  })

  it('splits a comma-separated list and trims whitespace', () => {
    process.env.NOTIFICATION_EMAILS =
      ' admin@forgehandyman.com , operations@forgehandyman.com '
    expect(getNotificationRecipients()).toEqual([
      'admin@forgehandyman.com',
      'operations@forgehandyman.com',
    ])
  })

  it('overrides BUSINESS_EMAIL rather than appending to it', () => {
    process.env.BUSINESS_EMAIL = 'admin@forgehandyman.com'
    process.env.NOTIFICATION_EMAILS = 'operations@forgehandyman.com'
    expect(getNotificationRecipients()).toEqual(['operations@forgehandyman.com'])
  })

  it('dedupes case-insensitively', () => {
    process.env.NOTIFICATION_EMAILS =
      'admin@forgehandyman.com,Admin@ForgeHandyman.com,operations@forgehandyman.com'
    expect(getNotificationRecipients()).toEqual([
      'admin@forgehandyman.com',
      'operations@forgehandyman.com',
    ])
  })

  it('drops a malformed entry but keeps the rest', () => {
    process.env.NOTIFICATION_EMAILS = 'admin@forgehandyman.com,not-an-email,ops@forgehandyman.com'
    expect(getNotificationRecipients()).toEqual([
      'admin@forgehandyman.com',
      'ops@forgehandyman.com',
    ])
  })

  it('throws when nothing valid is configured', () => {
    expect(() => getNotificationRecipients()).toThrow(/notification recipients/i)
  })

  it('throws when every configured entry is malformed', () => {
    process.env.NOTIFICATION_EMAILS = 'nope,also-nope'
    expect(() => getNotificationRecipients()).toThrow(/notification recipients/i)
  })
})

describe('getNotificationTo', () => {
  it('renders an RFC 2822 comma-separated To header', () => {
    process.env.NOTIFICATION_EMAILS =
      'admin@forgehandyman.com,operations@forgehandyman.com'
    expect(getNotificationTo()).toBe(
      'admin@forgehandyman.com, operations@forgehandyman.com',
    )
  })
})
