import { Icon } from "@/lib/icons";

type Props = {
  quote: string;
  name: string;
  location: string;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => /^[a-z]/i.test(w))
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function TestimonialCard({ quote, name, location }: Props) {
  return (
    <figure className="relative flex h-full flex-col rounded-lg border-2 border-ink bg-card p-7 shadow-card">
      <span
        className="absolute right-6 top-4 font-display text-[60px] leading-[0.6] text-line"
        aria-hidden="true"
      >
        &rdquo;
      </span>
      <div className="flex gap-0.5 text-orange" aria-label="5-star rating">
        {Array.from({ length: 5 }).map((_, i) => (
          <Icon key={i} name="star" className="h-[18px] w-[18px] fill-current" />
        ))}
      </div>
      <blockquote className="relative mt-3.5 flex-1 text-[16.5px] leading-relaxed text-ink">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="mt-[18px] flex items-center gap-3 border-t-[1.5px] border-dashed border-line pt-4">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-ink font-display text-[17px] font-bold text-paper">
          {initials(name)}
        </span>
        <span>
          <span className="block font-display text-[16px] font-bold text-ink">
            {name}
          </span>
          <span className="block text-[13px] text-ink-3">{location}</span>
        </span>
      </figcaption>
    </figure>
  );
}
