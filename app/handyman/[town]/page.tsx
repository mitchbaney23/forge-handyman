import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CTABanner } from "@/components/CTABanner";
import { BUSINESS, TESTIMONIALS } from "@/lib/constants";
import { TOWNS, townBySlug } from "@/lib/towns";

// Static per-town landing pages — each town name inside the 20-mile service
// radius is a local-SEO keyword (the same reasoning behind listing all 8 towns
// in the site copy instead of "greater Raleigh area").

export const dynamic = "force-static";
// Only the 8 known slugs exist — junk slugs 404 statically instead of
// triggering an on-demand render.
export const dynamicParams = false;

export function generateStaticParams(): { town: string }[] {
  return TOWNS.map((t) => ({ town: t.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ town: string }>;
}): Promise<Metadata> {
  const { town: slug } = await params;
  const town = townBySlug(slug);
  if (!town) return {};
  // The layout's title template appends "| Forge Handyman Service".
  return {
    title: `Handyman in ${town.name}, NC`,
    description: `Trusted local handyman serving ${town.name}, NC. Flat-rate repairs, TV mounting, drywall, plumbing fixes, assembly & more. 40 years of craftsmanship, fully insured, free estimates.`,
    alternates: { canonical: `/handyman/${town.slug}` },
    openGraph: {
      title: `Handyman in ${town.name}, NC — Forge Handyman Service`,
      description: `Flat-rate handyman services in ${town.name}, NC from a 40-year veteran craftsman. Free estimates, self-schedule online.`,
    },
  };
}

export default async function TownPage({
  params,
}: {
  params: Promise<{ town: string }>;
}) {
  const { town: slug } = await params;
  const town = townBySlug(slug);
  if (!town) notFound();

  // Prefer testimonials from this town; fall back to the full set.
  const local = TESTIMONIALS.filter((t) =>
    t.location.startsWith(`${town.name},`),
  );
  const testimonials = (local.length > 0 ? local : TESTIMONIALS).slice(0, 2);

  const siteUrl = BUSINESS.siteUrl.replace(/\/$/, "");
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: "Handyman services",
    provider: { "@id": `${siteUrl}/#business` },
    areaServed: {
      "@type": "City",
      name: town.name,
      address: { "@type": "PostalAddress", addressRegion: "NC" },
    },
    url: `${siteUrl}/handyman/${town.slug}`,
  };

  return (
    <>
      <section className="bg-navy py-16 text-paper sm:py-20">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="eyebrow text-ember">Handyman in {town.name}, NC</p>
          <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">
            Honest repairs for {town.name} homes
          </h1>
          <p className="mt-3 text-lg text-paper/85">{town.headline}</p>
        </div>
      </section>

      <section className="py-12 sm:py-16">
        <div className="mx-auto max-w-4xl space-y-10 px-4 sm:px-6">
          <p className="text-lg leading-relaxed text-ink/80">{town.blurb}</p>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              {
                title: "Flat-rate menu",
                body: "Most jobs have a published price — see the full services menu before you book.",
              },
              {
                title: "Self-schedule online",
                body: "Pick a real open slot on David's calendar. No phone tag.",
              },
              {
                title: "Fully insured",
                body: "40 years of hands-on craftsmanship, full coverage for your home.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-xl border border-navy/10 bg-white p-5 shadow-card"
              >
                <h2 className="font-display text-base font-bold text-navy">
                  {card.title}
                </h2>
                <p className="mt-2 text-sm text-ink/70">{card.body}</p>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {testimonials.map((t) => (
              <blockquote
                key={t.name}
                className="rounded-xl border border-navy/10 bg-white p-6 shadow-card"
              >
                <p className="text-ink/80">&ldquo;{t.quote}&rdquo;</p>
                <footer className="mt-3 text-sm font-semibold text-navy">
                  {t.name} · {t.location}
                </footer>
              </blockquote>
            ))}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href="/contact" className="btn-primary">
              Book a job in {town.name}
            </Link>
            <Link
              href="/services"
              className="rounded-lg border border-navy/20 px-5 py-3 text-sm font-semibold text-navy hover:border-navy"
            >
              See the flat-rate menu
            </Link>
          </div>

          <p className="text-sm text-ink/60">
            {BUSINESS.serviceAreaLine}. Bookings run roughly a 20-mile radius
            around Garner — {town.name} is well inside it. Call{" "}
            <a href={BUSINESS.phoneHref} className="font-semibold text-navy hover:text-orange">
              {BUSINESS.phone}
            </a>{" "}
            with any questions.
          </p>
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
