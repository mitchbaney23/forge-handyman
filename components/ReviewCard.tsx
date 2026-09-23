import Image from "next/image";
import { Icon } from "@/lib/icons";
import type { GoogleReview } from "@/lib/reviews/google";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[a-z]/i.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * One Google review, in the same shop-ticket card style the old hand-written
 * testimonials used. Everything on the card comes from Google: author name and
 * photo, star count, text, and Google's own "a week ago" timestamp.
 */
export function ReviewCard({ review }: { review: GoogleReview }) {
  const { authorName, authorUri, authorPhotoUri, rating, text, relativeTime } = review;
  const stars = Math.max(0, Math.min(5, Math.round(rating)));

  return (
    <figure className="relative flex h-full flex-col rounded-lg border-2 border-ink bg-card p-7 shadow-card">
      <span
        className="absolute right-6 top-4 font-display text-[60px] leading-[0.6] text-line"
        aria-hidden="true"
      >
        &rdquo;
      </span>
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5" aria-label={`${stars}-star rating`} role="img">
          {Array.from({ length: 5 }).map((_, i) => (
            <Icon
              key={i}
              name="star"
              className={`h-[18px] w-[18px] fill-current ${i < stars ? "text-orange" : "text-line"}`}
            />
          ))}
        </div>
        {relativeTime ? (
          <span className="text-[13px] text-ink-3">{relativeTime}</span>
        ) : null}
      </div>
      <blockquote className="relative mt-3.5 flex-1 whitespace-pre-line text-[16.5px] leading-relaxed text-ink">
        &ldquo;{text}&rdquo;
      </blockquote>
      <figcaption className="mt-[18px] flex items-center gap-3 border-t-[1.5px] border-dashed border-line pt-4">
        {authorPhotoUri ? (
          <Image
            src={authorPhotoUri}
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 flex-none rounded-full object-cover"
          />
        ) : (
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-ink font-display text-[17px] font-bold text-paper">
            {initials(authorName)}
          </span>
        )}
        <span>
          {authorUri ? (
            <a
              href={authorUri}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block font-display text-[16px] font-bold text-ink hover:underline"
            >
              {authorName}
            </a>
          ) : (
            <span className="block font-display text-[16px] font-bold text-ink">
              {authorName}
            </span>
          )}
          <span className="block text-[13px] text-ink-3">Google review</span>
        </span>
      </figcaption>
    </figure>
  );
}
