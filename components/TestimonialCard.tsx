import { Icon } from "@/lib/icons";

type Props = {
  quote: string;
  name: string;
  location: string;
};

export function TestimonialCard({ quote, name, location }: Props) {
  return (
    <figure className="flex h-full flex-col rounded-xl border border-navy/10 bg-white p-6 shadow-card">
      <div className="flex gap-1 text-amber-forge" aria-label="5-star rating">
        {Array.from({ length: 5 }).map((_, i) => (
          <Icon key={i} name="star" className="h-4 w-4 fill-current" />
        ))}
      </div>
      <blockquote className="mt-4 flex-1 text-sm leading-relaxed text-ink/85">
        &ldquo;{quote}&rdquo;
      </blockquote>
      <figcaption className="mt-5 border-t border-navy/10 pt-4">
        <div className="text-sm font-semibold text-navy">{name}</div>
        <div className="text-xs text-ink/60">{location}</div>
      </figcaption>
    </figure>
  );
}
