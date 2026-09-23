import { afterEach, describe, expect, it } from 'vitest'
import {
  getGoogleMapsUrl,
  getGoogleReviewUrl,
  parsePlaceDetails,
  selectReviews,
  type GoogleReview,
} from '@/lib/reviews/google'

// Pure unit tests for the Google reviews module: response parsing, homepage
// selection, and link derivation. No network — fetchGoogleReviews() is
// exercised in the browser against the live listing, not here.

const PLACE_ID = 'ChIJtestPlaceId'

// Trimmed-down shape of a real Places API (New) Place Details response.
const SAMPLE = {
  id: PLACE_ID,
  rating: 5,
  userRatingCount: 2,
  googleMapsUri: 'https://maps.google.com/?cid=123',
  reviews: [
    {
      name: `places/${PLACE_ID}/reviews/one`,
      relativePublishTimeDescription: 'a week ago',
      rating: 5,
      text: { text: 'Absolutely wonderful job!', languageCode: 'en' },
      authorAttribution: {
        displayName: 'Tyler L.',
        uri: 'https://www.google.com/maps/contrib/1',
        photoUri: 'https://lh3.googleusercontent.com/a/photo=s128',
      },
      publishTime: '2026-09-12T15:00:00Z',
    },
    {
      name: `places/${PLACE_ID}/reviews/two`,
      relativePublishTimeDescription: 'a week ago',
      rating: 5,
      text: { text: 'I highly recommend Forge Handyman Service!', languageCode: 'en' },
      authorAttribution: { displayName: 'Nafi A.' },
      publishTime: '2026-09-13T15:00:00Z',
    },
  ],
}

function review(overrides: Partial<GoogleReview>): GoogleReview {
  return {
    id: 'r',
    authorName: 'Someone',
    rating: 5,
    text: 'Good work.',
    publishTime: '2026-01-01T00:00:00Z',
    relativeTime: 'a while ago',
    ...overrides,
  }
}

const ENV_KEYS = ['GOOGLE_PLACE_ID', 'GOOGLE_REVIEW_URL'] as const
const saved: Record<string, string | undefined> = {}
for (const k of ENV_KEYS) saved[k] = process.env[k]
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('parsePlaceDetails', () => {
  it('maps a real-shaped response into a snapshot', () => {
    const snap = parsePlaceDetails(SAMPLE, PLACE_ID)
    expect(snap.placeId).toBe(PLACE_ID)
    expect(snap.rating).toBe(5)
    expect(snap.ratingCount).toBe(2)
    expect(snap.mapsUri).toBe('https://maps.google.com/?cid=123')
    expect(snap.reviews).toHaveLength(2)
    expect(snap.reviews[0]).toEqual({
      id: `places/${PLACE_ID}/reviews/one`,
      authorName: 'Tyler L.',
      authorUri: 'https://www.google.com/maps/contrib/1',
      authorPhotoUri: 'https://lh3.googleusercontent.com/a/photo=s128',
      rating: 5,
      text: 'Absolutely wonderful job!',
      publishTime: '2026-09-12T15:00:00Z',
      relativeTime: 'a week ago',
    })
    // No uri/photo → left undefined, not empty string.
    expect(snap.reviews[1].authorUri).toBeUndefined()
    expect(snap.reviews[1].authorPhotoUri).toBeUndefined()
  })

  it('tolerates a listing with no reviews and no rating', () => {
    const snap = parsePlaceDetails({ id: PLACE_ID }, PLACE_ID)
    expect(snap.reviews).toEqual([])
    expect(snap.rating).toBeNull()
    expect(snap.ratingCount).toBe(0)
    expect(snap.mapsUri).toContain(encodeURIComponent(PLACE_ID))
  })

  it('drops malformed reviews instead of throwing', () => {
    const snap = parsePlaceDetails(
      {
        reviews: [
          null,
          { rating: 'five', authorAttribution: { displayName: 'X' } },
          { rating: 9, authorAttribution: { displayName: 'X' } },
          { rating: 4 }, // no author
          { rating: 4, authorAttribution: { displayName: 'Rating Only' } },
        ],
      },
      PLACE_ID,
    )
    expect(snap.reviews).toHaveLength(1)
    expect(snap.reviews[0].authorName).toBe('Rating Only')
    expect(snap.reviews[0].text).toBe('')
  })

  it('handles garbage bodies', () => {
    expect(parsePlaceDetails(null, PLACE_ID).reviews).toEqual([])
    expect(parsePlaceDetails('nope', PLACE_ID).reviews).toEqual([])
    expect(parsePlaceDetails([1, 2], PLACE_ID).reviews).toEqual([])
  })
})

describe('selectReviews', () => {
  it('drops star-only reviews, sorts newest first, and caps', () => {
    const picked = selectReviews(
      [
        review({ id: 'old', publishTime: '2025-01-01T00:00:00Z' }),
        review({ id: 'blank', text: '' }),
        review({ id: 'new', publishTime: '2026-09-01T00:00:00Z' }),
        review({ id: 'mid', publishTime: '2026-03-01T00:00:00Z' }),
      ],
      2,
    )
    expect(picked.map((r) => r.id)).toEqual(['new', 'mid'])
  })

  it('does not filter by star rating', () => {
    const picked = selectReviews([review({ id: 'low', rating: 2 })])
    expect(picked.map((r) => r.id)).toEqual(['low'])
  })
})

describe('review links', () => {
  it('prefers the explicit override', () => {
    process.env.GOOGLE_REVIEW_URL = 'https://g.page/r/abc/review'
    process.env.GOOGLE_PLACE_ID = PLACE_ID
    expect(getGoogleReviewUrl()).toBe('https://g.page/r/abc/review')
  })

  it('derives the write-review link from the Place ID', () => {
    delete process.env.GOOGLE_REVIEW_URL
    process.env.GOOGLE_PLACE_ID = PLACE_ID
    expect(getGoogleReviewUrl()).toBe(
      `https://search.google.com/local/writereview?placeid=${PLACE_ID}`,
    )
    expect(getGoogleMapsUrl(null)).toBe(
      `https://www.google.com/maps/place/?q=place_id:${PLACE_ID}`,
    )
  })

  it('falls back to a Google search when nothing is configured', () => {
    delete process.env.GOOGLE_REVIEW_URL
    delete process.env.GOOGLE_PLACE_ID
    expect(getGoogleReviewUrl()).toContain('google.com/search?q=Forge+Handyman')
    expect(getGoogleMapsUrl(null)).toContain('google.com/search?q=Forge+Handyman')
  })

  it('uses the snapshot maps link when one is present', () => {
    const snap = parsePlaceDetails(SAMPLE, PLACE_ID)
    expect(getGoogleMapsUrl(snap)).toBe('https://maps.google.com/?cid=123')
  })
})
