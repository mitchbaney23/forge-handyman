import type { Metadata } from "next";
import Link from "next/link";
import { CTABanner } from "@/components/CTABanner";
import { PageHeader } from "@/components/PageHeader";
import { Reveal } from "@/components/Reveal";
import {
  FAMILY_DISCOUNT_LABEL,
  FAMILY_MENU,
  FAMILY_PACKAGES,
  FORGE_FAMILY,
} from "@/lib/family-pricing";
import { Icon, type IconName } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Forge Family Pricing — Friends & Family Rates",
  description:
    "Friends & family pricing from Forge Handyman: every posted rate, discounted, in exchange for an honest review and feedback on how we did.",
  // Invite-only page — shared by link, kept out of search results and the sitemap.
  robots: { index: false, follow: false },
};

function dollars(cents: number): string {
  return `$${cents / 100}`;
}

// "The deal" — three short steps shown up top.
const DEAL_STEPS = [
  {
    n: "1",
    title: "Pick your family price",
    body: "Everything on the menu below is already marked down to your Forge Family rate. No code to remember, no haggling.",
  },
  {
    n: "2",
    title: "We do the work right",
    body: "Same craftsman, same standards as any paying job. On time, done right, cleaned up before we leave.",
  },
  {
    n: "3",
    title: "Tell us how we did",
    body: "Afterward, leave an honest review and a few minutes of straight feedback — what worked, what we could do better.",
  },
];

export default function FamilyPage() {
  return (
    <>
      <PageHeader stamp="Forge Family" title="Family pricing — our thanks, up front.">
        You&rsquo;re getting Forge Family rates:{" "}
        <strong className="text-ink">{FAMILY_DISCOUNT_LABEL} off every posted price</strong>,
        no catch. All we ask in return is {FORGE_FAMILY.ask}. That&rsquo;s the deal
        — help us sharpen the process, and the family rate is yours.
      </PageHeader>

      {/* The deal */}
      <section className="bg-card">
        <div className="container-page section-tight">
          <Reveal>
            <div className="grid gap-5 md:grid-cols-3">
              {DEAL_STEPS.map((step) => (
                <div
                  key={step.n}
                  className="rounded-lg border-2 border-ink bg-card p-6 shadow-card"
                >
                  <div className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-orange font-display text-lg font-bold text-white">
                    {step.n}
                  </div>
                  <h3 className="mt-4 font-display text-lg font-bold">{step.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">
                    {step.body}
                  </p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <section className="bg-paper">
        <div className="container-page section space-y-16">
          {/* Signature packages — family priced */}
          <Reveal>
            <div className="flex flex-col gap-2 border-b-2 border-ink pb-4 sm:flex-row sm:items-end sm:justify-between">
              <h2 className="font-display text-[clamp(24px,3vw,32px)] font-bold">
                Signature Packages
              </h2>
              <p className="max-w-[46ch] text-[14.5px] text-ink-2">
                Got a list? Book a block of time and we&rsquo;ll work straight
                down it — at your family rate.
              </p>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {FAMILY_PACKAGES.map((pkg) => {
                const saved = pkg.baseCents - pkg.priceCents;
                return (
                  <div
                    key={pkg.number}
                    className="flex flex-col rounded-lg border-2 border-ink bg-card p-6 shadow-card"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-[40px] font-bold leading-none text-orange">
                        #{pkg.number}
                      </span>
                      <div className="text-right">
                        <span className="block font-display text-2xl font-bold">
                          {pkg.price}
                        </span>
                        <span className="text-[13px] text-ink-3 line-through">
                          {pkg.basePrice}
                        </span>
                      </div>
                    </div>
                    <h3 className="mt-4 font-display text-xl">{pkg.name}</h3>
                    <p className="mt-1 text-[14.5px] text-ink-2">
                      {pkg.hours} hours · {pkg.blurb}
                    </p>
                    <span className="mt-3 inline-flex w-fit items-center rounded-full bg-orange/[0.12] px-2.5 py-1 text-[12px] font-bold text-orange">
                      Save {dollars(saved)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Reveal>

          {/* À la carte menu — family priced */}
          {FAMILY_MENU.map((section) => (
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
                    <span className="text-[13px] leading-tight text-ink-3 line-through">
                      {item.basePrice}
                    </span>
                    <span className="font-display text-[17px] font-bold leading-tight text-orange">
                      {item.price}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}

          <p className="text-center text-[14px] text-ink-3">
            Family rate is {FAMILY_DISCOUNT_LABEL} off the posted price · $95
            minimum per visit · unusual or oversized jobs quoted on site.
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
              Ready to put us to work?
            </h3>
            <p className="mx-auto mt-3 max-w-[48ch] text-base text-ink-2">
              Tell us what&rsquo;s on your list and mention{" "}
              <strong className="text-ink">&ldquo;Forge Family&rdquo;</strong> when
              you reach out — we&rsquo;ll lock in your family rate.
            </p>
            <div className="mt-6 flex flex-col gap-3.5 sm:flex-row">
              <Link href="/contact" className="btn-primary">
                Book a Job at Family Rates
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <CTABanner
        heading="Honest work, family price."
        subheading="Pick from the menu or tell us what you're working on — and tell us how we did."
      />
    </>
  );
}
