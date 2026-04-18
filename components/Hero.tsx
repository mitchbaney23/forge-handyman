import Link from "next/link";
import { BUSINESS } from "@/lib/constants";
import { Icon } from "@/lib/icons";

export function Hero() {
  return (
    <section className="texture-navy relative overflow-hidden text-white">
      <div className="absolute inset-0 opacity-[0.04]" aria-hidden="true">
        <svg
          className="h-full w-full"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 40 40"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
      </div>
      <div className="container-page relative py-20 sm:py-24 lg:py-32">
        <div className="max-w-3xl">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-amber-forge-light">
            <span className="h-px w-8 bg-amber-forge-light" />
            {BUSINESS.tagline}
          </p>
          <h1 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
            Your Trusted Handyman in
            <span className="block text-amber-forge-light">Garner &amp; Clayton, NC</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/80">
            Honest work. Fair prices. A craftsman you can trust in your home.
            Forty years of hands-on experience, one call away.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/contact" className="btn-primary text-base">
              Book a Job
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
            <a href={BUSINESS.phoneHref} className="btn-secondary text-base">
              <Icon name="phone" className="h-4 w-4" />
              Call {BUSINESS.phone}
            </a>
          </div>
          <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/70">
            <span className="flex items-center gap-1.5">
              <Icon name="check" className="h-4 w-4 text-amber-forge-light" />
              Free estimates
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="check" className="h-4 w-4 text-amber-forge-light" />
              Licensed &amp; insured
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="check" className="h-4 w-4 text-amber-forge-light" />
              Same-week availability
            </span>
          </p>
        </div>
      </div>
      <div className="h-1 w-full bg-amber-forge" aria-hidden="true" />
    </section>
  );
}
