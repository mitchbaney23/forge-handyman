import type { Metadata } from "next";
import { ContactForm } from "@/components/ContactForm";
import { BUSINESS } from "@/lib/constants";
import { Icon } from "@/lib/icons";

export const metadata: Metadata = {
  title: "Book a Job — Contact Forge Handyman Service",
  description:
    "Book a handyman in Garner, Clayton, or South Raleigh. Fill out the quick form, or call David at (555) 123-4567. Free estimates, one-business-day response.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <section className="texture-navy text-white">
        <div className="container-page py-16 sm:py-20">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-forge-light">
              Book a Job
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Tell Us What Needs Doing
            </h1>
            <p className="mt-5 text-lg text-white/80">
              Fill out the form and David will respond within one business day
              with a free estimate. In a hurry?{" "}
              <a
                href={BUSINESS.phoneHref}
                className="font-semibold text-amber-forge-light hover:text-white"
              >
                Give us a call
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      <section className="bg-cream">
        <div className="container-page section grid gap-10 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <ContactForm />
          </div>
          <aside className="space-y-5 lg:col-span-2">
            <InfoCard
              icon="phone"
              title="Call Us"
              body={
                <>
                  <a
                    href={BUSINESS.phoneHref}
                    className="text-lg font-semibold text-navy hover:text-amber-forge"
                  >
                    {BUSINESS.phone}
                  </a>
                  <p className="mt-1 text-sm text-ink/70">
                    Talk to a real person — usually David or Mitch.
                  </p>
                </>
              }
            />
            <InfoCard
              icon="mail"
              title="Email"
              body={
                <>
                  <a
                    href={BUSINESS.emailHref}
                    className="text-lg font-semibold text-navy hover:text-amber-forge"
                  >
                    {BUSINESS.email}
                  </a>
                  <p className="mt-1 text-sm text-ink/70">
                    Send photos or details — we respond within one business day.
                  </p>
                </>
              }
            />
            <InfoCard
              icon="clock"
              title="Business Hours"
              body={
                <ul className="space-y-1 text-sm text-ink/80">
                  {BUSINESS.hours.map((h) => (
                    <li key={h.day} className="flex justify-between gap-4">
                      <span className="font-semibold text-navy">{h.day}</span>
                      <span>{h.time}</span>
                    </li>
                  ))}
                </ul>
              }
            />
            <InfoCard
              icon="map-pin"
              title="Service Area"
              body={
                <p className="text-sm text-ink/75">
                  {BUSINESS.serviceAreaLine}. Bookings are limited to roughly a
                  15-mile radius of Garner so we can stay local and responsive.
                </p>
              }
            />
          </aside>
        </div>
      </section>
    </>
  );
}

function InfoCard({
  icon,
  title,
  body,
}: {
  icon: "phone" | "mail" | "clock" | "map-pin";
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-6 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-forge/15 text-amber-forge">
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-navy">
          {title}
        </h2>
      </div>
      <div className="mt-4">{body}</div>
    </div>
  );
}
