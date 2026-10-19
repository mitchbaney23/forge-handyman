import { describe, expect, it } from 'vitest'
import {
  buildReviewRequestHtml,
  buildReviewRequestText,
  reviewRequestSubject,
} from '@/lib/email/review-request'
import { reviewAskCopy } from '@/lib/reviews/review-ask-copy'

// The review request in Mitch's words (lib/reviews/review-ask-copy.ts), shared
// by the review email and both receipts.

describe('review ask wording', () => {
  it('names the job when it knows it, otherwise says this job', () => {
    expect(reviewAskCopy('your TV mounting project in Garner').opening).toBe(
      "Thank you so much for choosing Forge! We're so happy we could help with your TV mounting project in Garner.",
    )
    expect(reviewAskCopy().opening).toBe(
      "Thank you so much for choosing Forge! We're so happy we could help with this job.",
    )
  })

  it('the review email thanks them for the job, asks, and invites them to reply', () => {
    const data = { toEmail: 'jane@example.com', toName: 'Jane Doe', serviceLabel: 'TV mounting', customerCity: 'Garner' }
    const text = buildReviewRequestText(data, 'https://forge.test/unsubscribe')
    expect(text).toContain('Hi Jane,')
    expect(text).toContain('help with your TV mounting project in Garner.')
    expect(text).toContain("so we'd really appreciate it if you left us a Google review.")
    expect(text).toContain('Just reply to this email.')
    expect(text).toContain('— The Forge team')
    expect(text).not.toContain('Quick favor')
    expect(buildReviewRequestHtml(data, 'https://forge.test/unsubscribe')).toContain('Leave a Google review')
    expect(reviewRequestSubject('Jane Doe')).toBe('Thank you for choosing Forge, Jane')
    expect(reviewRequestSubject('')).toBe('Thank you for choosing Forge')
  })
})
