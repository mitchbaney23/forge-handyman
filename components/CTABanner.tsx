import Link from "next/link";
import { BUSINESS } from "@/lib/constants";
import { Icon } from "@/lib/icons";

type Props = {
  heading?: string;
  subheading?: string;
  // Where the "Book a Job" button points. Defaults to /contact; the Forge
  // Family page passes /contact?family=1 so the discount follows the friend.
  bookHref?: string;
};

export function CTABanner({
  heading = "Got a list? Let's knock it out.",
  subheading = "Tell us what needs doing. We'll get back to you with a free estimate — usually same day.",
  bookHref = "/contact",
}: Props) {
  return (
    <section className="relative overflow-hidden border-t-2 border-ink bg-orange text-white">
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)",
          backgroundSize: "34px 34px",
        }}
      />
      <div className="container-page relative py-20 text-center lg:py-24">
        <h2 className="mx-auto max-w-3xl font-display text-[clamp(34px,5vw,58px)] font-bold text-white">
          {heading}
        </h2>
        <p className="mx-auto mt-4 max-w-[38ch] text-lg text-white/[0.92]">
          {subheading}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href={bookHref} className="btn-white text-base">
            Book a Job
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
          <a href={BUSINESS.phoneHref} className="btn-ink text-base">
            <Icon name="phone" className="h-4 w-4" />
            {BUSINESS.phone}
          </a>
        </div>
      </div>
    </section>
  );
}
