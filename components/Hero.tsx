import Image from "next/image";
import Link from "next/link";
import { BUSINESS } from "@/lib/constants";
import { Icon } from "@/lib/icons";
import { Reveal } from "@/components/Reveal";

export function Hero() {
  return (
    <section className="border-b-2 border-ink bg-paper">
      <div className="container-page grid items-center gap-[52px] py-[72px] lg:grid-cols-[1.05fr_.95fr]">
        {/* Left column */}
        <Reveal>
          <span className="stamp">Honest Work · Built to Last</span>
          <h1 className="mt-6 font-display text-[clamp(40px,5vw,60px)] font-bold leading-[1.05] text-ink">
            Your neighborhood
            <span className="block text-orange">craftsman.</span>
          </h1>
          <p className="mt-6 max-w-[34ch] text-lg leading-relaxed text-ink-2">
            Honest work. Fair prices. A craftsman you can trust in your home.
            Forty years of hands-on experience, one call away.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/contact" className="btn-primary text-base">
              Book a Job
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
            <a href={BUSINESS.phoneHref} className="btn-outline text-base">
              <Icon name="phone" className="h-4 w-4" />
              Call {BUSINESS.phone}
            </a>
          </div>
          <div className="mt-7 flex flex-wrap gap-2">
            {[
              "Free estimates",
              "Fully insured",
              "Same-week availability",
            ].map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-line bg-card px-3.5 py-1.5 text-[13.5px] font-semibold text-ink-2"
              >
                <Icon name="check" className="h-[15px] w-[15px] text-orange" />
                {chip}
              </span>
            ))}
          </div>
        </Reveal>

        {/* Right column — Work Order ticket card */}
        <Reveal delay={120} className="mx-auto w-full max-w-[440px] lg:max-w-none">
          <div className="relative overflow-hidden rounded-lg border-2 border-ink bg-card shadow-ticket">
            {/* Header strip */}
            <div className="flex items-center justify-between bg-ink px-[22px] py-4 text-paper">
              <span className="font-display text-lg font-bold tracking-[0.02em]">
                Work Order
              </span>
              <span className="font-sans text-[12px] font-bold tracking-[0.14em] text-ember">
                № 0042
              </span>
            </div>
            {/* Photo area */}
            <div className="relative aspect-[16/10] overflow-hidden border-b-2 border-dashed border-line">
              <Image
                src="/david-at-work.jpg"
                alt="David Baney installing a new outdoor faucet"
                fill
                priority
                sizes="(max-width: 1024px) 90vw, 440px"
                className="object-cover"
              />
            </div>
            {/* Perforation detail */}
            <div
              className="pointer-events-none absolute -left-3 -right-3 h-6"
              style={{ top: "calc(16px + 50% - 2px)" }}
              aria-hidden="true"
            >
              <span className="absolute left-0 top-0 h-6 w-6 rounded-full border-2 border-ink bg-paper" />
              <span className="absolute right-0 top-0 h-6 w-6 rounded-full border-2 border-ink bg-paper" />
            </div>
            {/* Rows */}
            <div className="px-[22px] pb-[22px] pt-[18px]">
              {[
                { k: "Trade", v: "Carpentry & Repairs", ok: false },
                { k: "Estimate", v: "Free · Written", ok: true },
                { k: "Turnaround", v: "Same day", ok: false },
                { k: "Craftsman", v: "David Baney", ok: false },
              ].map((row, i, arr) => (
                <div
                  key={row.k}
                  className={`flex items-center justify-between py-[11px] ${
                    i < arr.length - 1 ? "border-b border-dashed border-line" : ""
                  }`}
                >
                  <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">
                    {row.k}
                  </span>
                  <span
                    className={`font-display text-[17px] font-bold ${
                      row.ok ? "text-teal" : "text-ink"
                    }`}
                  >
                    {row.v}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
