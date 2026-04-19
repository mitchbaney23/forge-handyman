import Link from "next/link";
import { Hero } from "@/components/Hero";
import { TrustBar } from "@/components/TrustBar";
import { ServiceCard } from "@/components/ServiceCard";
import { TestimonialCard } from "@/components/TestimonialCard";
import { CTABanner } from "@/components/CTABanner";
import { SERVICES, TESTIMONIALS, BUSINESS } from "@/lib/constants";
import { Icon } from "@/lib/icons";

export default function HomePage() {
  return (
    <>
      <Hero />
      <TrustBar />

      <Section
        eyebrow="What We Do"
        heading="Services for Every Room and Every Season"
        subheading="One call, one craftsman, and your list gets shorter. Here's what we handle most."
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((service) => (
            <ServiceCard key={service.key} service={service} />
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link
            href="/services"
            className="btn-outline"
          >
            See all services
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
        </div>
      </Section>

      <section className="bg-white">
        <div className="container-page section">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Why Forge</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              A Real Craftsman, Not a Franchise Technician
            </h2>
            <p className="mt-4 text-base text-ink/75">
              Forge Handyman Service is owned and operated by David Baney — a
              lifelong craftsman who treats your home like it&rsquo;s his own.
            </p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <FeatureBlock
              icon="hammer"
              title="40 Years of Experience"
              body="David brings decades of hands-on mechanical and maintenance skill to every job. You get a craftsman — not a random technician dispatched from a call center."
            />
            <FeatureBlock
              icon="dollar"
              title="Honest, Upfront Pricing"
              body="Free estimates in writing. No surprise charges, no 'while we're in there' upsells. We quote the work and we stick to it."
            />
            <FeatureBlock
              icon="calendar"
              title="Easy Online Booking"
              body="Book online in 60 seconds. You'll get a confirmation and a response within one business day — no endless phone tag."
            />
          </div>
        </div>
      </section>

      <section className="bg-cream">
        <div className="container-page section">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">How It Works</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Three Simple Steps
            </h2>
          </div>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                n: "1",
                title: "Tell Us What You Need",
                body: "Fill out a quick form or give us a call. Share what needs doing and when you'd like it done.",
              },
              {
                n: "2",
                title: "Get a Free Estimate",
                body: "We'll review your request and get back to you with a clear, written estimate — usually same day.",
              },
              {
                n: "3",
                title: "We Get It Done",
                body: "We show up on time, do the work right, clean up when we're done, and only invoice for what we quoted.",
              },
            ].map((step) => (
              <li
                key={step.n}
                className="relative rounded-xl border border-navy/10 bg-white p-6 shadow-card"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-forge text-xl font-bold text-white">
                  {step.n}
                </div>
                <h3 className="mt-5 text-lg font-semibold text-navy">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-ink/75">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-page py-10 sm:py-12">
          <div className="flex flex-col items-center gap-3 rounded-xl border border-navy/10 bg-cream px-6 py-5 text-center sm:flex-row sm:justify-center sm:gap-4 sm:text-left">
            <Icon name="map-pin" className="h-5 w-5 text-amber-forge" />
            <p className="text-sm font-semibold text-navy sm:text-base">
              {BUSINESS.serviceAreaLine}
            </p>
          </div>
        </div>
      </section>

      <section className="bg-cream">
        <div className="container-page section">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">What Our Neighbors Say</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Trusted by Homeowners Across the Triangle
            </h2>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {TESTIMONIALS.map((t) => (
              <TestimonialCard key={t.name} {...t} />
            ))}
          </div>
        </div>
      </section>

      <CTABanner />
    </>
  );
}

function Section({
  eyebrow,
  heading,
  subheading,
  children,
}: {
  eyebrow: string;
  heading: string;
  subheading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-cream">
      <div className="container-page section">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{heading}</h2>
          <p className="mt-4 text-base text-ink/75">{subheading}</p>
        </div>
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function FeatureBlock({
  icon,
  title,
  body,
}: {
  icon: "hammer" | "dollar" | "calendar";
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-navy/10 bg-cream p-7">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-navy text-white">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-xl font-semibold text-navy">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-ink/75">{body}</p>
    </div>
  );
}

