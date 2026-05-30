import type { Metadata } from "next";
import { ContactForm } from "@/components/ContactForm";
import { PageHeader } from "@/components/PageHeader";
import { BUSINESS } from "@/lib/constants";
import { Icon, type IconName } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Book a Job — Contact Forge Handyman Service",
  description:
    "Book a handyman in Garner, Clayton, or South Raleigh. Fill out the quick form, or call David at (555) 123-4567. Free estimates, one-business-day response.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <PageHeader stamp="Book a Job" title="Tell us what needs doing">
        Fill out the form and David will respond within one business day with a
        free estimate. In a hurry?{" "}
        <a
          href={BUSINESS.phoneHref}
          className="font-semibold text-orange underline underline-offset-[3px]"
        >
          Give us a call
        </a>
        .
      </PageHeader>

      <section className="bg-paper">
        <div className="container-page section grid items-start gap-[34px] lg:grid-cols-[1.7fr_1fr]">
          <ContactForm />
          <aside>
            <InfoCard icon="phone" title="Call Us">
              <a
                href={BUSINESS.phoneHref}
                className="font-display text-xl font-bold text-ink hover:text-orange"
              >
                {BUSINESS.phone}
              </a>
              <p className="mt-1 text-[13.5px] text-ink-2">
                Talk to a real person — usually David or Mitch.
              </p>
            </InfoCard>
            <InfoCard icon="mail" title="Email">
              <a
                href={BUSINESS.emailHref}
                className="font-display text-xl font-bold text-ink hover:text-orange"
              >
                {BUSINESS.email}
              </a>
              <p className="mt-1 text-[13.5px] text-ink-2">
                Send photos or details — we respond within one business day.
              </p>
            </InfoCard>
            <InfoCard icon="clock" title="Business Hours">
              <div className="mt-1">
                {BUSINESS.hours.map((h) => (
                  <div
                    key={h.day}
                    className="flex justify-between gap-3 py-1 text-sm"
                  >
                    <span className="font-bold text-ink">{h.day}</span>
                    <span className="text-ink-2">{h.time}</span>
                  </div>
                ))}
              </div>
            </InfoCard>
            <InfoCard icon="map-pin" title="Service Area">
              <p className="text-[13.5px] text-ink-2">
                {BUSINESS.serviceAreaLine}. Bookings are limited to roughly a
                15-mile radius of Garner so we can stay local and responsive.
              </p>
            </InfoCard>
          </aside>
        </div>
      </section>
    </>
  );
}

function InfoCard({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border-2 border-ink bg-card p-[22px] shadow-card [&+&]:mt-4">
      <div className="flex items-center gap-3">
        <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[7px] bg-orange text-white">
          <Icon name={icon} className="h-[21px] w-[21px]" />
        </span>
        <h2 className="font-sans text-[13px] font-bold uppercase tracking-[0.12em] text-ink">
          {title}
        </h2>
      </div>
      <div className="mt-3.5">{children}</div>
    </div>
  );
}
