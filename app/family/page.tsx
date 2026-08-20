import type { Metadata } from "next";
import { CTABanner } from "@/components/CTABanner";
import { PageHeader } from "@/components/PageHeader";
import { Reveal } from "@/components/Reveal";
import {
  FAMILY_DISCOUNT_LABEL,
  FAMILY_MENU,
  FAMILY_PACKAGES,
} from "@/lib/family-pricing";
import { Icon, type IconName } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Forge Family Pricing — Friends & Family Rates",
  description:
    "Friends & family pricing from Forge Handyman: every posted rate, discounted, in exchange for an honest review and feedback on how we did.",
  // Invite-only page — shared by link, kept out of search results and the sitemap.
  robots: { index: false, follow: false },
};

export default function FamilyPage() {
  return (
    <>
      <PageHeader stamp="Forge Family" title="Family pricing">
        {FAMILY_DISCOUNT_LABEL} off every posted price.
      </PageHeader>

      <section className="bg-paper">
        <div className="container-page section space-y-16">
          {/* Signature packages — family priced */}
          <Reveal>
            <div className="border-b-2 border-ink pb-4">
              <h2 className="font-display text-[clamp(24px,3vw,32px)] font-bold">
                Signature Packages
              </h2>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-3">
              {FAMILY_PACKAGES.map((pkg) => (
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
                  <p className="mt-1 text-[14.5px] font-semibold text-ink">
                    {pkg.scope}
                  </p>
                  <p className="mt-1 text-[14.5px] text-ink-2">{pkg.blurb}</p>
                </div>
              ))}
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
                    <span className="text-right leading-tight">
                      <span className="font-display text-[17px] font-bold text-orange">
                        {item.price}
                      </span>
                      {item.addOnCents != null &&
                        item.addOnCents !== item.priceCents && (
                          <span className="block text-[12.5px] text-ink-3">
                            add another for {item.addOnPrice}
                          </span>
                        )}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}

          <p className="text-center text-[14px] text-ink-3">
            $95 minimum per visit · oversized jobs quoted on site.
          </p>
        </div>
      </section>

      <CTABanner
        heading="Ready to book?"
        subheading="Your Forge Family pricing comes with you — pick from the menu or tell us what you're working on."
        bookHref="/contact?family=1"
      />
    </>
  );
}
