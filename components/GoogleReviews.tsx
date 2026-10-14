import { Reveal } from "@/components/Reveal";
import { ReviewCard } from "@/components/ReviewCard";
import { Icon } from "@/lib/icons";
import {
  fetchGoogleReviews,
  getGoogleMapsUrl,
  getGoogleReviewUrl,
  selectReviews,
} from "@/lib/reviews/google";

/**
 * Homepage "What Our Neighbors Say" section, fed by the business's real
 * Google reviews (lib/reviews/google.ts). Server component: the fetch runs at
 * build/revalidate time, never in the visitor's browser.
 *
 * Degrades in two steps:
 *   - Google reachable but no written reviews yet → rating line + links only.
 *   - Not configured / Google down → links only, no invented numbers.
 */
export async function GoogleReviews() {
  const snapshot = await fetchGoogleReviews();
  const reviews = snapshot ? selectReviews(snapshot.reviews) : [];
  const mapsUrl = getGoogleMapsUrl(snapshot);
  const writeUrl = getGoogleReviewUrl();

  return (
    <section className="bg-paper">
      <div className="container-page section">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">What Our Neighbors Say</p>
          <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
            Trusted by homeowners across{" "}
            <span className="ink-underline">the Triangle</span>
          </h2>
          {snapshot && snapshot.rating !== null && snapshot.ratingCount > 0 ? (
            <p className="mt-4 flex items-center justify-center gap-2 text-[16px] text-ink-2">
              <span className="flex gap-0.5 text-orange" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Icon
                    key={i}
                    name="star"
                    className={`h-[18px] w-[18px] fill-current ${
                      i < Math.round(snapshot.rating ?? 0) ? "text-orange" : "text-line"
                    }`}
                  />
                ))}
              </span>
              <span>
                <strong className="font-display text-ink">{snapshot.rating.toFixed(1)}</strong>{" "}
                out of 5 from {snapshot.ratingCount}{" "}
                {snapshot.ratingCount === 1 ? "review" : "reviews"} on Google
              </span>
            </p>
          ) : null}
        </Reveal>

        {reviews.length > 0 ? (
          <div className="mt-12 grid gap-[22px] md:grid-cols-2">
            {reviews.map((r, i) => (
              <Reveal key={r.id} delay={i * 80}>
                <ReviewCard review={r} />
              </Reveal>
            ))}
          </div>
        ) : null}

        <Reveal className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline text-base"
          >
            Read our reviews on Google
          </a>
          <a
            href={writeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-base"
          >
            Leave a review
          </a>
        </Reveal>
        {reviews.length > 0 ? (
          <p className="mt-6 text-center text-[13px] text-ink-3">
            Reviews are pulled from our Google listing and refreshed every few hours.
          </p>
        ) : null}
      </div>
    </section>
  );
}
