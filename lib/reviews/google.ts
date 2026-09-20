// Google reviews for the public site.
//
// The homepage used to show hand-written testimonials from lib/constants.ts.
// This module replaces them with the business's real Google reviews, pulled
// server-side from the Places API (New) Place Details endpoint and cached by
// Next's data cache for REVIEWS_REVALIDATE_SECONDS. Google's Places terms allow
// caching place content for up to 30 days; we refresh far more often than that
// so a new review shows up the same day.
//
// Config (see .env.example):
//   GOOGLE_PLACE_ID          — the listing's Place ID ("ChIJ…"). Required.
//   GOOGLE_PLACES_API_KEY    — server-side key with Places API (New) enabled.
//                              Falls back to GOOGLE_GEOCODING_API_KEY, which is
//                              the site's existing server-side Maps key.
//   GOOGLE_REVIEW_URL        — optional override for the "leave a review" link.
//
// When anything is missing or Google errors, fetchGoogleReviews() returns null
// and the homepage falls back to plain links to the Google listing. It never
// throws into the page.

import { logger } from "@/lib/security/logger";

export type GoogleReview = {
  /** Google's review resource name — stable, used as the React key. */
  id: string;
  authorName: string;
  /** Link to the reviewer's Google profile, when Google provides one. */
  authorUri?: string;
  /** Reviewer avatar, when Google provides one. */
  authorPhotoUri?: string;
  /** 1–5 */
  rating: number;
  text: string;
  /** ISO-8601 */
  publishTime: string;
  /** Google's own phrasing, e.g. "a week ago" */
  relativeTime: string;
};

export type GoogleReviewsSnapshot = {
  placeId: string;
  /** Average rating across all reviews, or null if Google didn't send one. */
  rating: number | null;
  ratingCount: number;
  reviews: GoogleReview[];
  /** Link to the listing on Google Maps. */
  mapsUri: string;
};

/** How long a fetched snapshot is served before Next re-fetches it. */
export const REVIEWS_REVALIDATE_SECONDS = 6 * 60 * 60;

/** Most cards the homepage will show. Google returns at most 5 anyway. */
export const MAX_HOMEPAGE_REVIEWS = 6;

export function getGooglePlaceId(): string | null {
  const id = (process.env.GOOGLE_PLACE_ID || "").trim();
  return id || null;
}

function getPlacesApiKey(): string | null {
  const key = (
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_GEOCODING_API_KEY ||
    ""
  ).trim();
  return key || null;
}

/**
 * Where "leave us a review" links should send people. Explicit override first,
 * then the Place-ID-based write-review URL, then a Google search that surfaces
 * the business card. Shared by the homepage and the customer emails.
 */
export function getGoogleReviewUrl(): string {
  const override = (process.env.GOOGLE_REVIEW_URL || "").trim();
  if (override) return override;
  const placeId = getGooglePlaceId();
  if (placeId) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
  }
  return "https://www.google.com/search?q=Forge+Handyman+Service+Garner+NC";
}

/** Where "read all our reviews" links should send people. */
export function getGoogleMapsUrl(snapshot?: GoogleReviewsSnapshot | null): string {
  if (snapshot?.mapsUri) return snapshot.mapsUri;
  const placeId = getGooglePlaceId();
  if (placeId) {
    return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;
  }
  return "https://www.google.com/search?q=Forge+Handyman+Service+Garner+NC";
}

// Shape of the fields we ask Google for. Everything is optional because the
// API omits fields it has no data for (a listing with zero reviews has no
// `reviews` array at all, for example).
type PlaceDetailsResponse = {
  id?: string;
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: Array<{
    name?: string;
    relativePublishTimeDescription?: string;
    rating?: number;
    text?: { text?: string; languageCode?: string };
    originalText?: { text?: string; languageCode?: string };
    authorAttribution?: {
      displayName?: string;
      uri?: string;
      photoUri?: string;
    };
    publishTime?: string;
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Turn a raw Place Details response into our snapshot. Pure, so it's unit
 * tested directly. Tolerates missing/odd fields rather than throwing — a
 * malformed review is dropped, not fatal.
 */
export function parsePlaceDetails(
  body: unknown,
  placeId: string,
): GoogleReviewsSnapshot {
  const data: PlaceDetailsResponse = isRecord(body) ? (body as PlaceDetailsResponse) : {};

  const reviews: GoogleReview[] = [];
  for (const raw of Array.isArray(data.reviews) ? data.reviews : []) {
    if (!isRecord(raw)) continue;
    const rating = Number(raw.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) continue;
    const text = (raw.text?.text ?? raw.originalText?.text ?? "").trim();
    const authorName = (raw.authorAttribution?.displayName ?? "").trim();
    if (!authorName) continue;
    const publishTime = typeof raw.publishTime === "string" ? raw.publishTime : "";
    reviews.push({
      id: typeof raw.name === "string" && raw.name ? raw.name : `${authorName}:${publishTime}`,
      authorName,
      authorUri: raw.authorAttribution?.uri || undefined,
      authorPhotoUri: raw.authorAttribution?.photoUri || undefined,
      rating,
      text,
      publishTime,
      relativeTime: (raw.relativePublishTimeDescription ?? "").trim(),
    });
  }

  const rating = Number(data.rating);
  const ratingCount = Number(data.userRatingCount);

  return {
    placeId: typeof data.id === "string" && data.id ? data.id : placeId,
    rating: Number.isFinite(rating) && rating > 0 ? rating : null,
    ratingCount: Number.isFinite(ratingCount) && ratingCount > 0 ? Math.floor(ratingCount) : 0,
    reviews,
    mapsUri:
      typeof data.googleMapsUri === "string" && data.googleMapsUri
        ? data.googleMapsUri
        : `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`,
  };
}

/**
 * Pick which reviews go on the homepage: skip star-only reviews (nothing to
 * quote), newest first, capped. No rating filter — real reviews means all of
 * them, not just the flattering ones.
 */
export function selectReviews(
  reviews: GoogleReview[],
  limit: number = MAX_HOMEPAGE_REVIEWS,
): GoogleReview[] {
  return reviews
    .filter((r) => r.text.length > 0)
    .slice()
    .sort((a, b) => Date.parse(b.publishTime || "") - Date.parse(a.publishTime || ""))
    .slice(0, Math.max(0, limit));
}

/**
 * Fetch the listing's reviews. Returns null (and logs why) when the feature
 * isn't configured or Google fails, so callers can render a fallback.
 */
export async function fetchGoogleReviews(): Promise<GoogleReviewsSnapshot | null> {
  const placeId = getGooglePlaceId();
  const apiKey = getPlacesApiKey();
  if (!placeId || !apiKey) {
    logger.info(
      { hasPlaceId: Boolean(placeId), hasApiKey: Boolean(apiKey) },
      "google-reviews: not configured, skipping",
    );
    return null;
  }

  // GOOGLE_PLACES_API_BASE_URL exists only so local dev / tests can point at
  // a stub server. Leave it unset everywhere real.
  const base = (process.env.GOOGLE_PLACES_API_BASE_URL || "https://places.googleapis.com").replace(/\/+$/, "");
  const url = new URL(`${base}/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set("languageCode", "en");
  url.searchParams.set("regionCode", "US");

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "id,rating,userRatingCount,googleMapsUri,reviews",
      },
      next: { revalidate: REVIEWS_REVALIDATE_SECONDS },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, detail: detail.slice(0, 300) },
        "google-reviews: Place Details request failed",
      );
      return null;
    }

    const snapshot = parsePlaceDetails(await res.json(), placeId);
    logger.info(
      { ratingCount: snapshot.ratingCount, returned: snapshot.reviews.length },
      "google-reviews: fetched",
    );
    return snapshot;
  } catch (err) {
    logger.warn({ err }, "google-reviews: fetch threw");
    return null;
  }
}
