import type { Metadata } from "next";
import Link from "next/link";
import { CTABanner } from "@/components/CTABanner";
import { BUSINESS } from "@/lib/constants";
import { TOWNS } from "@/lib/towns";

// Single service-area page — the 8 towns listed plainly with per-town anchors
// (the footer's "Areas We Serve" links point here). Deliberately one page
// instead of eight near-identical landers: the homepage stays the front door,
// this catches "handyman + town" searches without doorway-page fluff.

export const metadata: Metadata = {
  title: "Service Area — Garner, Raleigh, Cary, Clayton & More",
  description: `Forge Handyman Service covers a 20-mile radius around Garner, NC: Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs & Fuquay-Varina. Flat-rate handyman services, free estimates.`,
  alternates: { canonical: "/service-area" },
};

export default function ServiceAreaPage() {
  const siteUrl = BUSINESS.siteUrl.replace(/\/$/, "");
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Handyman services",
    provider: { "@id": `${siteUrl}/#business` },
    areaServed: TOWNS.map((t) => ({
      "@type": "City",
      name: t.name,
      address: { "@type": "PostalAddress", addressRegion: "NC" },
    })),
    url: `${siteUrl}/service-area`,
  };

  return (
    <>
      <section className="bg-navy py-16 text-paper sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="eyebrow text-ember">Service Area</p>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">
            Where we work
          </h1>
          <p className="mt-3 text-lg text-paper/85">
            Based in Garner, serving roughly a 20-mile radius so we can stay
            local and responsive.
          </p>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-4xl space-y-10 px-4 sm:px-6">
          <p className="text-lg leading-relaxed text-ink/80">
            Same craftsman, same flat-rate menu, no travel surcharge anywhere
            in the coverage area. The booking form checks your address
            automatically — if you&rsquo;re outside the radius, give us a call
            at{" "}
            <a
              href={BUSINESS.phoneHref}
              className="font-semibold text-navy hover:text-orange"
            >
              {BUSINESS.phone}
            </a>{" "}
            and we&rsquo;ll see what we can do.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {TOWNS.map((town) => (
              <div
                key={town.slug}
                id={town.slug}
                className="rounded-xl border border-navy/10 bg-white p-5 shadow-card"
              >
                <h2 className="font-display text-lg font-bold text-navy">
                  {town.name}, NC
                </h2>
                <p className="mt-1 text-sm text-ink/70">{town.line}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/contact" className="btn-primary">
              Book a job
            </Link>
            <Link
              href="/services"
              className="rounded-lg border border-navy/20 px-5 py-3 text-sm font-semibold text-navy hover:border-navy"
            >
              See the flat-rate menu
            </Link>
          </div>
        </div>
      </section>

      <CTABanner />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </>
  );
}
