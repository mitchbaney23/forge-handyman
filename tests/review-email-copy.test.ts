import { describe, expect, it } from 'vitest'
import {
  buildReviewRequestHtml,
  buildReviewRequestText,
  reviewRequestSubject,
} from '@/lib/email/review-request'
import { reviewCityFrom } from '@/lib/reviews/request-fields'
import { reviewAskCopy } from '@/lib/reviews/review-ask-copy'

// The review request in Mitch's words (lib/reviews/review-ask-copy.ts), shared
// by the review email and both receipts.

describe('review ask wording', () => {
  it('names the job when it knows it, otherwise says this job', () => {
    expect(reviewAskCopy('your project in Garner').opening).toBe(
      "Thank you so much for choosing Forge! We're so happy we could help with your project in Garner.",
    )
    expect(reviewAskCopy().opening).toBe(
      "Thank you so much for choosing Forge! We're so happy we could help with this job.",
    )
  })

  it('the review email thanks them for the job, asks, and invites them to reply', () => {
    const data = { toEmail: 'jane@example.com', toName: 'Jane Doe', customerCity: 'Garner' }
    const text = buildReviewRequestText(data, 'https://forge.test/unsubscribe')
    expect(text).toContain('Hi Jane,')
    expect(text).toContain('help with your project in Garner.')
    expect(buildReviewRequestText({ toEmail: 'a@b.co', toName: 'Al' }, 'u')).toContain('help with your project.')
    expect(text).toContain("so we'd really appreciate it if you left us a Google review.")
    expect(text).toContain('Just reply to this email.')
    expect(text).toContain('— The Forge team')
    expect(text).not.toContain('Quick favor')
    expect(buildReviewRequestHtml(data, 'https://forge.test/unsubscribe')).toContain('Leave a Google review')
    expect(reviewRequestSubject('Jane Doe')).toBe('Thank you for choosing Forge, Jane')
    expect(reviewRequestSubject('')).toBe('Thank you for choosing Forge')
  })
})

describe('reviewCityFrom: the town from an address as people type it', () => {
  it.each([
    ['12 Oak St, Garner, NC 27529', 'Garner'],
    ['12 Oak St, Raleigh NC 27603', 'Raleigh'],
    ['12 Oak St, Clayton NC', 'Clayton'],
    ['12 Oak St, raleigh nc 27603', 'Raleigh'],
    ['12 Oak St, holly springs, nc', 'Holly Springs'],
    ['123 Main St, Clayton, NC 27520, USA', 'Clayton'],
    ['12 Oak St, Holly Springs, NC 27540-1234', 'Holly Springs'],
    ['Apt 4, 12 Oak St, Fuquay-Varina, NC', 'Fuquay-Varina'],
    ['2012 Raccoon Run, Clayton', 'Clayton'],
    ['Garner, NC', 'Garner'],
  ])('%s -> %s', (address, town) => {
    expect(reviewCityFrom(address)).toBe(town)
  })

  it.each(['', '12 Oak St', '12 Oak St Clayton NC 27520', 'NC 27529'])('no town in %j', (address) => {
    expect(reviewCityFrom(address)).toBeUndefined()
  })
})
