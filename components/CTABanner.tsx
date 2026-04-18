import Link from "next/link";
import { BUSINESS } from "@/lib/constants";
import { Icon } from "@/lib/icons";

type Props = {
  heading?: string;
  subheading?: string;
};

export function CTABanner({
  heading = "Ready to Cross It Off Your List?",
  subheading = "Tell us what needs doing. We'll get back to you with a free estimate — usually same day.",
}: Props) {
  return (
    <section className="relative overflow-hidden bg-navy text-white">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-navy via-navy-600 to-steel opacity-90"
      />
      <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-amber-forge/20 blur-3xl" aria-hidden="true" />
      <div className="container-page relative py-14 lg:py-16">
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-center">
          <div className="max-w-xl">
            <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {heading}
            </h2>
            <p className="mt-3 text-base text-white/80">{subheading}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/contact" className="btn-primary text-base">
              Book a Job
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
            <a href={BUSINESS.phoneHref} className="btn-secondary text-base">
              <Icon name="phone" className="h-4 w-4" />
              {BUSINESS.phone}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
