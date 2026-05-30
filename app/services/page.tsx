import type { Metadata } from "next";
import Link from "next/link";
import { ServiceCard } from "@/components/ServiceCard";
import { CTABanner } from "@/components/CTABanner";
import { PageHeader } from "@/components/PageHeader";
import { Reveal } from "@/components/Reveal";
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
        stamp="Services"
        title="Everything your home needs — one craftsman"
      >
        We don&rsquo;t list prices on the site because every job is different.
        What we promise: a free, honest estimate and no surprises once
        we&rsquo;re on site.
      </PageHeader>

      <section className="bg-paper">
        <div className="container-page section space-y-16">
          {CATEGORY_ORDER.map((category) => {
            const services = SERVICES.filter((s) => s.category === category);
            return (
              <Reveal key={category}>
                <div className="flex flex-col gap-2 border-b-2 border-ink pb-4 sm:flex-row sm:items-end sm:justify-between">
                  <h2 className="font-display text-[clamp(24px,3vw,32px)] font-bold">
                    {category}
                  </h2>
                  <p className="max-w-[48ch] text-[14.5px] text-ink-2">
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
              </Reveal>
            );
          })}
        </div>
      </section>

      <section className="bg-card">
        <div className="container-page section-tight">
          <Reveal className="mx-auto flex max-w-[760px] flex-col items-center rounded-xl border-2 border-dashed border-ink bg-card p-11 text-center">
            <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-orange/[0.12] text-orange">
              <Icon name="handshake" className="h-[26px] w-[26px]" />
            </div>
            <h3 className="mt-[18px] font-display text-[clamp(24px,3vw,32px)] font-bold">
              Not sure if we can help? Just ask.
            </h3>
            <p className="mx-auto mt-3 max-w-[48ch] text-base text-ink-2">
              If it&rsquo;s broken, leaking, loose, or just on your list —
              there&rsquo;s a good chance we handle it. Send us the details and
              we&rsquo;ll tell you straight.
            </p>
            <div className="mt-6 flex flex-col gap-3.5 sm:flex-row">
              <Link href="/contact" className="btn-primary">
                Request a Free Estimate
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
              <a href="tel:+15551234567" className="btn-outline">
                <Icon name="phone" className="h-4 w-4" />
                Call (555) 123-4567
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      <CTABanner
        heading="Got a project in mind?"
        subheading="Tell us what you're working on. We'll tell you honestly whether we can help — and what it'll cost."
      />
    </>
  );
}
