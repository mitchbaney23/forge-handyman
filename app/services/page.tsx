import type { Metadata } from "next";
import Link from "next/link";
import { CTABanner } from "@/components/CTABanner";
import { PageHeader } from "@/components/PageHeader";
import { Reveal } from "@/components/Reveal";
import { SERVICE_MENU, SERVICE_PACKAGES } from "@/lib/constants";
import { Icon, type IconName } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Service Menu — Flat-Rate Handyman Pricing",
  description:
    "Forge Handyman's flat-rate service menu: general repairs, installation & assembly, painting & drywall, minor plumbing, and TV mounting. Honest prices posted up front, no surprises. Free estimates in Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs & Fuquay-Varina.",
  alternates: { canonical: "/services" },
};

export default function ServicesPage() {
  return (
    <>
      <PageHeader stamp="Service Menu" title="Pick what you need. Know the price.">
        Flat rates, posted right here — no guessing games and no surprise
        invoices. The price you see is the price you pay. Bigger or unusual jobs
        get a free, honest estimate on site.
      </PageHeader>

      <section className="bg-paper">
        <div className="container-page section space-y-16">
          {/* Signature packages */}
          <Reveal>
            <div className="flex flex-col gap-2 border-b-2 border-ink pb-4 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="font-display text-[clamp(24px,3vw,32px)] font-bold">
                Signature Packages
              </h2>
              <p className="max-w-[46ch] text-[14.5px] text-ink-2">
                Got a list? Book a block of time and we&rsquo;ll work straight
                down it — just tell us &ldquo;I&rsquo;ll take the #1.&rdquo;
              </p>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {SERVICE_PACKAGES.map((pkg) => (
                <div
                  key={pkg.number}
                  className="flex flex-col rounded-lg border-2 border-ink bg-card p-6 shadow-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-[40px] font-bold leading-none text-orange">
                      #{pkg.number}
                    </span>
                    <span className="font-display text-2xl font-bold">
                      {pkg.price}
                    </span>
                  </div>
                  <h3 className="mt-4 font-display text-xl">{pkg.name}</h3>
                  <p className="mt-1 text-[14.5px] text-ink-2">
                    {pkg.hours} hours · {pkg.blurb}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>

          {/* Parts & fixtures policy — stated once, up front, so item names
              stay clean (no "(you supply X)" after every line). */}
          <Reveal>
            <div className="flex items-start gap-3 rounded-lg border-2 border-dashed border-ink bg-card px-5 py-4">
              <div className="flex h-[36px] w-[36px] flex-none items-center justify-center rounded-lg bg-orange/[0.12] text-orange">
                <Icon name="tag" className="h-[20px] w-[20px]" />
              </div>
              <p className="text-[14.5px] leading-snug text-ink-2">
                <span className="font-semibold text-ink">Parts &amp; fixtures:</span>{" "}
                posted prices are labor plus basic materials. Bigger parts —
                faucets, fans, TVs, detectors, batteries — you supply, or add{" "}
                <span className="font-semibold text-ink">part pickup</span> to any
                job for a small fee.
              </p>
            </div>
          </Reveal>

          {/* À la carte menu */}
          {SERVICE_MENU.map((section) => (
            <Reveal key={section.category}>
              <div className="flex items-center gap-3 border-b-2 border-ink pb-4">
                <div className="flex h-[44px] w-[44px] flex-none items-center justify-center rounded-lg bg-orange text-white">
                  <Icon
                    name={section.icon as IconName}
                    className="h-[24px] w-[24px]"
                  />
                </div>
                <h2 className="font-display text-[clamp(22px,3vw,30px)] font-bold">
                  {section.category}
                </h2>
              </div>
              {section.note && (
                <p className="mt-3 text-[13.5px] italic text-ink-3">{section.note}</p>
              )}
              <ul className="mt-4">
                {section.items.map((item) => (
                  <li
                    key={item.name}
                    className="flex items-end gap-2 border-b border-dashed border-line py-3 last:border-b-0"
                  >
                    <span className="text-[15.5px] leading-tight text-ink">
                      {item.name}
                    </span>
                    <span
                      className="mb-[5px] flex-1 border-b border-dotted border-line"
                      aria-hidden="true"
                    />
                    <span className="font-display text-[17px] font-bold leading-tight text-ink">
                      {item.price}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}

          <p className="text-center text-[14px] text-ink-3">
            $95 minimum · free estimates · unusual or oversized jobs quoted on
            site.
          </p>
        </div>
      </section>

      <section className="bg-card">
        <div className="container-page section-tight">
          <Reveal className="mx-auto flex max-w-[760px] flex-col items-center rounded-xl border-2 border-dashed border-ink bg-card p-11 text-center">
            <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-orange/[0.12] text-orange">
              <Icon name="handshake" className="h-[26px] w-[26px]" />
            </div>
            <h3 className="mt-[18px] font-display text-[clamp(24px,3vw,32px)] font-bold">
              Don&rsquo;t see it on the menu? Just ask.
            </h3>
            <p className="mx-auto mt-3 max-w-[48ch] text-base text-ink-2">
              If it&rsquo;s broken, leaking, loose, or just on your list —
              there&rsquo;s a good chance we handle it. Send us the details and
              we&rsquo;ll quote it straight.
            </p>
            <div className="mt-6 flex flex-col gap-3.5 sm:flex-row">
              <Link href="/contact" className="btn-primary">
                Request a Free Estimate
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <CTABanner
        heading="Ready to shorten your list?"
        subheading="Pick from the menu or tell us what you're working on. Honest prices, no surprises."
      />
    </>
  );
}
