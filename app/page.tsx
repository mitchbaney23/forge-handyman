import Link from "next/link";
import { Hero } from "@/components/Hero";
import { TrustBar } from "@/components/TrustBar";
import { ServiceCard } from "@/components/ServiceCard";
import { TestimonialCard } from "@/components/TestimonialCard";
import { CTABanner } from "@/components/CTABanner";
import { Reveal } from "@/components/Reveal";
import { SERVICES, TESTIMONIALS, BUSINESS } from "@/lib/constants";
import { Icon, type IconName } from "@/lib/icons";

export default function HomePage() {
  return (
    <>
      <Hero />
      <TrustBar />

      {/* Services — shop-ticket cards */}
      <section className="bg-paper">
        <div className="container-page section">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">What We Do</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
              Services for every room &amp;{" "}
              <span className="ink-underline">every season</span>
            </h2>
            <p className="mt-4 text-base text-ink-2">
              One call, one craftsman, and your list gets shorter. Here&rsquo;s
              what we handle most.
            </p>
          </Reveal>
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SERVICES.map((service, i) => (
              <Reveal key={service.key} delay={i * 80}>
                <ServiceCard service={service} index={i} />
              </Reveal>
            ))}
          </div>
          <div className="mt-10 text-center">
            <Link href="/services" className="btn-navy">
              See all services
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Why Forge */}
      <section className="bg-card">
        <div className="container-page section">
          <div className="grid items-center gap-[58px] lg:grid-cols-[0.92fr_1.08fr]">
            <Reveal className="mx-auto w-full max-w-[380px] lg:max-w-none">
              <div
                className="relative flex aspect-[4/5] flex-col items-center justify-center gap-3.5 rounded-lg border-2 border-ink text-ink-3 shadow-ticket"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg,rgba(36,33,27,.045) 0 16px,transparent 16px 32px),linear-gradient(160deg,#E7DCC5,#dccfb2)",
                }}
              >
                <Icon name="hammer" className="h-14 w-14 opacity-50" />
                <span className="text-[12px] font-bold uppercase tracking-[0.12em]">
                  David Baney
                </span>
                {/* 40 Years badge */}
                <span className="absolute right-2 top-6 flex h-24 w-24 rotate-[8deg] flex-col items-center justify-center rounded-full border-[3px] border-card bg-orange text-center text-white shadow-[0_8px_20px_rgba(36,33,27,.25)] lg:-right-4">
                  <span className="font-display text-3xl font-bold leading-none">
                    40
                  </span>
                  <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.08em]">
                    Years
                  </span>
                </span>
              </div>
            </Reveal>
            <div>
              <Reveal>
                <p className="eyebrow">Why Forge</p>
                <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
                  A real craftsman, not a franchise technician
                </h2>
                <p className="mt-4 text-base text-ink-2">
                  Forge Handyman Service is owned and operated by David Baney — a
                  lifelong craftsman who treats your home like it&rsquo;s his own.
                </p>
              </Reveal>
              <div className="mt-8">
                {FEATURES.map((f, i) => (
                  <Reveal key={f.title} delay={i * 80}>
                    <FeatureBlock {...f} />
                  </Reveal>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works — blueprint */}
      <section className="blueprint border-y-2 border-ink">
        <div className="container-page section relative">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow text-ember">How It Works</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-paper sm:text-4xl">
              Three simple steps
            </h2>
          </Reveal>
          <ol className="mt-12 grid gap-[22px] md:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal as="li" key={step.n} delay={i * 80}>
                <div className="relative h-full rounded-[7px] border-[1.5px] border-paper/20 bg-paper/[0.05] p-[30px_26px]">
                  <div className="flex h-[50px] w-[50px] items-center justify-center rounded-full border-2 border-card bg-orange font-display text-[22px] font-bold text-white">
                    {step.n}
                  </div>
                  <h3 className="mt-[18px] font-display text-[21px] font-bold text-paper">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-paper/[0.72]">
                    {step.body}
                  </p>
                  {i < STEPS.length - 1 && (
                    <span className="absolute -right-[22px] top-[54px] z-10 hidden text-ember md:block">
                      <Icon name="arrow-right" className="h-6 w-6" />
                    </span>
                  )}
                </div>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* Service Area strip */}
      <section className="bg-card">
        <div className="container-page py-10 sm:py-12">
          <Reveal className="flex flex-col items-center justify-center gap-3.5 rounded-lg border-2 border-dashed border-ink bg-card px-6 py-[22px] text-center sm:flex-row">
            <Icon name="map-pin" className="h-[22px] w-[22px] flex-none text-orange" />
            <p className="font-display text-[clamp(17px,2.2vw,22px)] font-bold text-ink">
              {BUSINESS.serviceAreaLine}
            </p>
          </Reveal>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-paper">
        <div className="container-page section">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">What Our Neighbors Say</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">
              Trusted by homeowners across{" "}
              <span className="ink-underline">the Triangle</span>
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-[22px] md:grid-cols-2">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 80}>
                <TestimonialCard {...t} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CTABanner />
    </>
  );
}

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: "hammer",
    title: "40 Years of Experience",
    body: "David brings decades of hands-on mechanical and maintenance skill to every job. You get a craftsman — not a random technician dispatched from a call center.",
  },
  {
    icon: "dollar",
    title: "Honest, Upfront Pricing",
    body: "Free estimates in writing. No surprise charges, no 'while we're in there' upsells. We quote the work and we stick to it.",
  },
  {
    icon: "calendar",
    title: "Easy Online Booking",
    body: "Book online in 60 seconds. You'll get a confirmation and a response within one business day — no endless phone tag.",
  },
];

const STEPS = [
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
];

function FeatureBlock({
  icon,
  title,
  body,
}: {
  icon: IconName;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-[18px] border-t-[1.5px] border-dashed border-line py-[22px] first:border-t-0 first:pt-1">
      <div className="flex h-[50px] w-[50px] flex-none items-center justify-center rounded-[7px] bg-ink text-ember">
        <Icon name={icon} className="h-[25px] w-[25px]" />
      </div>
      <div>
        <h3 className="font-display text-xl font-bold">{title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{body}</p>
      </div>
    </div>
  );
}
