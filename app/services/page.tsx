import type { Metadata } from "next";
import Link from "next/link";
import { ServiceCard } from "@/components/ServiceCard";
import { CTABanner } from "@/components/CTABanner";
import { SERVICES } from "@/lib/constants";
import type { ServiceCategory } from "@/lib/constants";
import { Icon } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Services — Handyman, Carpentry, Painting & More",
  description:
    "Full list of handyman services offered by Forge Handyman Service: general repairs, carpentry, painting, assembly, deck/fence work, drywall, and pressure washing. Free estimates.",
  alternates: { canonical: "/services" },
};

const CATEGORY_ORDER: ServiceCategory[] = [
  "General Repairs & Maintenance",
  "Carpentry & Woodwork",
  "Painting",
  "Assembly & Installation",
  "Outdoor & Seasonal",
];

const CATEGORY_BLURBS: Record<ServiceCategory, string> = {
  "General Repairs & Maintenance":
    "The punch list that never seems to shrink. We tackle it in one visit so you can stop thinking about it.",
  "Carpentry & Woodwork":
    "Old-school carpentry skill for trim, shelving, doors, and custom builds around the house.",
  Painting:
    "Interior rooms, trim, and smaller exterior projects — prepped properly and painted cleanly.",
  "Assembly & Installation":
    "Fixtures, fans, flat-pack furniture, and anything else that came in a box with too many pieces.",
  "Outdoor & Seasonal":
    "Decks, fences, pressure washing, and the outdoor projects that come with owning a home in the South.",
};

export default function ServicesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Services"
        title="Everything Your Home Needs — One Craftsman"
        subtitle="We don't list prices on the site because every job is different. What we promise: a free, honest estimate and no surprises once we're on site."
      />

      <section className="bg-white">
        <div className="container-page section space-y-16">
          {CATEGORY_ORDER.map((category) => {
            const services = SERVICES.filter((s) => s.category === category);
            return (
              <div key={category}>
                <div className="flex flex-col gap-2 border-b border-navy/10 pb-5 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="eyebrow">{category}</p>
                    <h2 className="mt-2 text-2xl font-bold sm:text-3xl">
                      {category}
                    </h2>
                  </div>
                  <p className="max-w-lg text-sm text-ink/70">
                    {CATEGORY_BLURBS[category]}
                  </p>
                </div>
                <div className="mt-8 grid gap-5 md:grid-cols-2">
                  {services.map((service) => (
                    <ServiceCard
                      key={service.key}
                      service={service}
                      variant="full"
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-cream">
        <div className="container-page section-tight">
          <div className="mx-auto flex max-w-3xl flex-col items-center rounded-2xl border border-navy/10 bg-white p-8 text-center shadow-card sm:p-12">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-forge/15 text-amber-forge">
              <Icon name="handshake" className="h-6 w-6" />
            </div>
            <h3 className="mt-5 text-2xl font-bold sm:text-3xl">
              Not sure if we can help? Just ask.
            </h3>
            <p className="mt-3 max-w-xl text-base text-ink/75">
              If it&rsquo;s broken, leaking, loose, or just on your list —
              there&rsquo;s a good chance we handle it. Send us the details and
              we&rsquo;ll tell you straight.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link href="/contact" className="btn-primary">
                Request a Free Estimate
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
              <a href="tel:+18285519690" className="btn-outline">
                <Icon name="phone" className="h-4 w-4" />
                Call (828) 551-9690
              </a>
            </div>
          </div>
        </div>
      </section>

      <CTABanner
        heading="Got a Project in Mind?"
        subheading="Tell us what you're working on. We'll tell you honestly whether we can help — and what it'll cost."
      />
    </>
  );
}

function PageHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <section className="texture-navy text-white">
      <div className="container-page py-16 sm:py-20 lg:py-24">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-forge-light">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 text-lg text-white/80">{subtitle}</p>
        </div>
      </div>
    </section>
  );
}
