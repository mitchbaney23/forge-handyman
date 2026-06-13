import type { Metadata } from "next";
import Link from "next/link";
import { CTABanner } from "@/components/CTABanner";
import { Reveal } from "@/components/Reveal";
import { BUSINESS, VALUES } from "@/lib/constants";
import { Icon, type IconName } from "@/lib/icons";

export const metadata: Metadata = {
  title: "About David Baney — 40 Years of Craftsmanship",
  description:
    "Meet David Baney, the 40-year veteran craftsman behind Forge Handyman Service. Family-run, locally owned, serving Wake and Johnston Counties with integrity.",
  alternates: { canonical: "/about" },
};

const FACTS: { icon: IconName; term: string; def: React.ReactNode }[] = [
  {
    icon: "hammer",
    term: "40+ Years Experience",
    def: "Hands-on craftsmanship, not franchise training.",
  },
  {
    icon: "home",
    term: "Locally Owned",
    def: "Family-run, based right here in Garner, NC.",
  },
  {
    icon: "shield",
    term: "Fully Insured",
    def: "Full coverage for your home and our work.",
  },
  {
    icon: "phone",
    term: "One Point of Contact",
    def: (
      <>
        Call{" "}
        <a href={BUSINESS.phoneHref} className="font-semibold hover:text-orange">
          {BUSINESS.phone}
        </a>{" "}
        and talk to someone real.
      </>
    ),
  },
];

const DIFF = [
  {
    title: "We show up on time",
    body: "If we say 9 AM, we're there at 9 AM. If something changes, you hear it from us first — not from a missed appointment.",
  },
  {
    title: "We treat your home with respect",
    body: "Drop cloths, shoe covers, and clean-up when we're done. You shouldn't have to clean up after the handyman.",
  },
  {
    title: "We tell you the truth",
    body: "Even when that means recommending less work, or pointing out that something doesn't actually need fixing yet.",
  },
  {
    title: "We're not going anywhere",
    body: "We live here. If something isn't right a week later, we're a phone call away — not a disconnected number.",
  },
];

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b-2 border-ink bg-card">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-paper-dots opacity-50"
          style={{ backgroundSize: "5px 5px" }}
        />
        <div className="container-page relative grid items-center gap-12 py-16 lg:grid-cols-[1.4fr_1fr]">
          <Reveal>
            <span className="stamp">About Forge</span>
            <h1 className="mt-[18px] font-display text-[clamp(38px,5vw,58px)] font-bold leading-[1.02]">
              A craftsman your neighbor would recommend
            </h1>
            <p className="mt-4 max-w-[60ch] text-lg text-ink-2">
              Forge Handyman Service is a family-run business rooted in four
              decades of hands-on craftsmanship and a simple idea: show up on
              time, do the work right, and treat every home like it&rsquo;s your
              own.
            </p>
          </Reveal>
          <Reveal delay={120} className="mx-auto w-full max-w-[360px] lg:max-w-none">
            <div
              className="relative flex aspect-[4/5] flex-col items-center justify-center gap-2.5 rounded-[10px] border-2 border-ink p-6 text-center text-ink-3 shadow-ticket"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(135deg,rgba(36,33,27,.045) 0 16px,transparent 16px 32px),linear-gradient(160deg,#E7DCC5,#dccfb2)",
              }}
            >
              <span className="flex h-24 w-24 items-center justify-center rounded-full bg-orange text-white">
                <Icon name="hammer" className="h-[42px] w-[42px]" />
              </span>
              <span className="mt-1 font-display text-lg font-bold text-ink">
                David Baney
              </span>
              <span className="text-[11px] uppercase tracking-[0.18em] text-ink-3">
                Owner &amp; Craftsman
              </span>
              <span className="absolute -right-4 top-6 flex h-[92px] w-[92px] rotate-[8deg] flex-col items-center justify-center rounded-full border-[3px] border-card bg-orange text-center text-white shadow-[0_8px_20px_rgba(36,33,27,.25)]">
                <span className="font-display text-3xl font-bold leading-none">
                  40
                </span>
                <span className="text-[9px] font-bold uppercase tracking-[0.08em]">
                  Years
                </span>
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Story + Fast Facts */}
      <section className="bg-paper">
        <div className="container-page section grid gap-12 lg:grid-cols-[1.7fr_1fr]">
          <Reveal>
            <p className="eyebrow">Our Story</p>
            <h2 className="mt-3 font-display text-[clamp(28px,3.6vw,40px)] font-bold">
              Forty years of fixing, building, and doing it right
            </h2>
            <div className="mt-6 space-y-[18px] text-[16.5px] leading-relaxed text-ink-2">
              <p>
                Forge Handyman Service is a proud, homegrown NC family business
                backed by more than 40 years of experience. Our reputation is
                built the same way a forge shapes steel &mdash; through hard work,
                dedication, and attention to detail.
              </p>
              <p>
                We aren&rsquo;t just working in your community; we are a part of
                it. We believe in honest communication, dependable service, and
                fair pricing that respects your hard-earned money. Every project
                is an opportunity to serve our neighbors with the integrity and
                craftsmanship they deserve.
              </p>
              <p>
                Whether it&rsquo;s a repair or a home improvement project,
                we&rsquo;re committed to delivering quality work you can count on.
                Forging lasting relationships, one project at a time.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="rounded-[9px] border-2 border-ink bg-card p-6 shadow-card">
              <p className="eyebrow">The Fast Facts</p>
              <dl className="mt-4">
                {FACTS.map((f) => (
                  <div
                    key={f.term}
                    className="flex gap-3 border-t-[1.5px] border-dashed border-line py-3.5 first:border-t-0 first:pt-1"
                  >
                    <Icon
                      name={f.icon}
                      className="mt-0.5 h-[22px] w-[22px] flex-none text-orange"
                    />
                    <div>
                      <dt className="font-display text-base font-bold">
                        {f.term}
                      </dt>
                      <dd className="mt-0.5 text-[13.5px] text-ink-2">{f.def}</dd>
                    </div>
                  </div>
                ))}
              </dl>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Values */}
      <section className="bg-card">
        <div className="container-page section">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Our Values</p>
            <h2 className="mt-3 font-display text-[clamp(28px,3.6vw,40px)] font-bold">
              The four things we never compromise on
            </h2>
          </Reveal>
          <div className="mt-12 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((value, i) => (
              <Reveal key={value.title} delay={i * 80}>
                <div className="h-full rounded-lg border-2 border-ink bg-card p-6 shadow-card">
                  <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[7px] bg-ink font-display text-lg font-bold text-ember">
                    {i + 1}
                  </div>
                  <h3 className="mt-3.5 font-display text-[19px] font-bold">
                    {value.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-2">
                    {value.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Why we're different */}
      <section className="bg-paper">
        <div className="container-page section">
          <Reveal className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Why We&rsquo;re Different</p>
            <h2 className="mt-3 font-display text-[clamp(28px,3.6vw,40px)] font-bold">
              Personal service, start to finish
            </h2>
          </Reveal>
          <div className="mx-auto mt-10 max-w-[760px]">
            {DIFF.map((item, i) => (
              <Reveal key={item.title} delay={i * 70}>
                <div className="mt-3.5 flex gap-4 rounded-lg border-2 border-ink bg-card p-5 shadow-card first:mt-0">
                  <div className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-lg bg-orange text-white">
                    <Icon name="check" className="h-[21px] w-[21px]" />
                  </div>
                  <div>
                    <h3 className="font-display text-lg font-bold">
                      {item.title}
                    </h3>
                    <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">
                      {item.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
            <div className="mt-10 text-center">
              <Link href="/contact" className="btn-primary">
                Book with David
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      <CTABanner
        heading="Meet the craftsman in your driveway"
        subheading="Book a job with Forge and see the difference a 40-year veteran makes."
      />
    </>
  );
}
