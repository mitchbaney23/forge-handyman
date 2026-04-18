import type { Metadata } from "next";
import Link from "next/link";
import { CTABanner } from "@/components/CTABanner";
import { SERVICE_AREA, BUSINESS } from "@/lib/constants";
import { Icon } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Service Area — Garner, Clayton, South Raleigh & Beyond",
  description:
    "Forge Handyman Service proudly serves Garner, Clayton, South Raleigh, Fuquay-Varina, Knightdale, Wendell, Smithfield, Archer Lodge, Willow Spring, and surrounding Wake and Johnston County communities.",
  alternates: { canonical: "/service-area" },
};

export default function ServiceAreaPage() {
  return (
    <>
      <section className="texture-navy text-white">
        <div className="container-page py-16 sm:py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-forge-light">
              Service Area
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Local to You, Across the Triangle
            </h1>
            <p className="mt-5 text-lg text-white/80">
              Forge Handyman Service is based in Garner and covers communities
              across Wake and Johnston Counties. If your neighborhood is on
              this list, you&rsquo;re one call away from a craftsman who shows
              up.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-page section">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {SERVICE_AREA.map((area) => (
              <article
                key={area.name}
                className="flex h-full flex-col rounded-xl border border-navy/10 bg-cream p-6 shadow-card"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-forge/15 text-amber-forge">
                    <Icon name="map-pin" className="h-5 w-5" />
                  </span>
                  <h2 className="text-xl font-semibold text-navy">
                    {area.name}, NC
                  </h2>
                </div>
                <p className="mt-4 flex-1 text-sm leading-relaxed text-ink/75">
                  {area.blurb}
                </p>
                <Link
                  href="/contact"
                  className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-amber-forge hover:text-amber-forge-dark"
                >
                  Book a job in {area.name}
                  <Icon name="arrow-right" className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-cream">
        <div className="container-page section-tight">
          <div className="mx-auto max-w-3xl rounded-2xl border border-navy/10 bg-white p-8 shadow-card sm:p-10">
            <p className="eyebrow">Just Outside Our Map?</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Don&rsquo;t see your area? Give us a call.
            </h2>
            <p className="mt-3 text-base text-ink/75">
              We cover communities all across Wake and Johnston Counties, and
              we&rsquo;re happy to consider projects just outside our usual
              radius. If you&rsquo;re close to Garner, Clayton, Raleigh,
              Fuquay, Smithfield, or anywhere in between — reach out and
              we&rsquo;ll tell you straight whether we can help.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className="btn-primary">
                Ask About Your Area
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
              <a href={BUSINESS.phoneHref} className="btn-outline">
                <Icon name="phone" className="h-4 w-4" />
                Call {BUSINESS.phone}
              </a>
            </div>
          </div>
        </div>
      </section>

      <CTABanner />
    </>
  );
}
