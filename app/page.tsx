import Link from "next/link";
import { Hero } from "@/components/Hero";
import { TrustBar } from "@/components/TrustBar";
import { ServiceCard } from "@/components/ServiceCard";
import { TestimonialCard } from "@/components/TestimonialCard";
import { CTABanner } from "@/components/CTABanner";
import { SERVICES, TESTIMONIALS, SERVICE_AREA } from "@/lib/constants";
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
        <div className="container-page section grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="eyebrow">Service Area</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Proudly Serving Our Neighbors in Wake &amp; Johnston Counties
            </h2>
            <p className="mt-4 text-base text-ink/75">
              Forge is a local business for local folks. If you&rsquo;re in or
              around any of these communities, we&rsquo;re just a call away.
            </p>
            <ul className="mt-6 grid grid-cols-2 gap-2 text-sm font-medium text-navy sm:grid-cols-3">
              {SERVICE_AREA.map((area) => (
                <li
                  key={area.name}
                  className="flex items-center gap-2 rounded-md border border-navy/10 bg-cream px-3 py-2"
                >
                  <Icon name="map-pin" className="h-4 w-4 text-amber-forge" />
                  {area.name}, NC
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-ink/60">
              Not listed?{" "}
              <Link href="/contact" className="font-semibold text-amber-forge hover:underline">
                Give us a call
              </Link>{" "}
              — we may still be able to help.
            </p>
          </div>
          <div
            className="relative aspect-[4/3] overflow-hidden rounded-xl border border-navy/10 bg-cream"
            aria-label="Service area map placeholder"
          >
            <MapIllustration />
            {/* Placeholder for embedded Google Map. Replace with iframe when ready.
                <img src="/service-area-map.jpg" alt="Map of Garner, Clayton and South Raleigh service area" /> */}
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

function MapIllustration() {
  return (
    <svg
      viewBox="0 0 400 300"
      className="h-full w-full"
      role="img"
      aria-label="Stylized map of Wake and Johnston County service area"
    >
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#E8EEF5" />
          <stop offset="100%" stopColor="#F8F9FA" />
        </linearGradient>
      </defs>
      <rect width="400" height="300" fill="url(#bg)" />
      <g stroke="#C5D3E2" strokeWidth="1" fill="none">
        <path d="M0 80 L400 60" />
        <path d="M0 140 L400 130" />
        <path d="M0 210 L400 200" />
        <path d="M60 0 L80 300" />
        <path d="M180 0 L200 300" />
        <path d="M300 0 L310 300" />
      </g>
      <g fill="#4A6FA5" opacity="0.25">
        <path d="M40 80 L180 50 L260 120 L210 220 L90 200 Z" />
        <path d="M220 150 L330 100 L360 200 L280 240 Z" />
      </g>
      <g fontFamily="Inter, sans-serif" fontSize="11" fill="#1B3A5C" fontWeight="600">
        <g>
          <circle cx="120" cy="140" r="6" fill="#D97706" />
          <text x="132" y="144">Garner</text>
        </g>
        <g>
          <circle cx="250" cy="175" r="6" fill="#D97706" />
          <text x="262" y="179">Clayton</text>
        </g>
        <g>
          <circle cx="170" cy="90" r="5" fill="#1B3A5C" />
          <text x="182" y="94">S. Raleigh</text>
        </g>
        <g>
          <circle cx="80" cy="220" r="5" fill="#1B3A5C" />
          <text x="92" y="224">Fuquay</text>
        </g>
        <g>
          <circle cx="310" cy="145" r="5" fill="#1B3A5C" />
          <text x="322" y="149">Wendell</text>
        </g>
        <g>
          <circle cx="340" cy="215" r="5" fill="#1B3A5C" />
          <text x="280" y="240">Smithfield</text>
        </g>
      </g>
    </svg>
  );
}
