import type { Metadata } from "next";
import Link from "next/link";
import { CTABanner } from "@/components/CTABanner";
import { BUSINESS, VALUES } from "@/lib/constants";
import { Icon } from "@/lib/icons";

export const metadata: Metadata = {
  title: "About David Baney — 40 Years of Craftsmanship",
  description:
    "Meet David Baney, the 40-year veteran craftsman behind Forge Handyman Service. Family-run, locally owned, serving Wake and Johnston Counties with integrity.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <>
      <section className="texture-navy text-white">
        <div className="container-page py-16 sm:py-20 lg:py-24">
          <div className="grid gap-10 lg:grid-cols-5 lg:items-center">
            <div className="lg:col-span-3">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-forge-light">
                About Forge
              </p>
              <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
                A Craftsman Your Neighbor Would Recommend
              </h1>
              <p className="mt-5 text-lg text-white/80">
                Forge Handyman Service is a family-run business rooted in four
                decades of hands-on craftsmanship and a simple idea: show up on
                time, do the work right, and treat every home like it&rsquo;s
                your own.
              </p>
            </div>
            <div className="lg:col-span-2">
              <div
                className="aspect-[4/5] overflow-hidden rounded-2xl border border-white/15 bg-white/5 shadow-xl"
                aria-label="Portrait of David Baney"
              >
                <div className="flex h-full w-full flex-col items-center justify-center p-6 text-center text-white/70">
                  {/* <img src="/david-baney.jpg" alt="David Baney, owner of Forge Handyman Service" className="h-full w-full object-cover" /> */}
                  <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-forge/20 text-amber-forge-light">
                    <Icon name="hammer" className="h-10 w-10" />
                  </div>
                  <p className="mt-4 text-sm font-semibold text-white">
                    David Baney
                  </p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-white/50">
                    Owner &amp; Craftsman
                  </p>
                  <p className="mt-4 max-w-[18ch] text-xs text-white/50">
                    (Photo coming soon — real headshot goes here)
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-page section grid gap-12 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <p className="eyebrow">Our Story</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              Forty years of fixing, building, and doing it right
            </h2>
            <div className="prose-ink mt-6 space-y-5 text-base">
              <p>
                David Baney has been building and fixing things for over 40
                years. Long before this was a business, it was a way of life —
                the kind of lifelong, hands-on work where you learn by doing,
                and you do a lot of it.
              </p>
              <p>
                Forge Handyman Service was started with one goal: bring that
                kind of craftsmanship back to the homeowner. Not a call-center
                dispatcher, not a rotating crew of technicians you&rsquo;ve
                never met — just a real person who shows up to your home,
                listens to what you need, and does the job right the first
                time.
              </p>
              <p>
                Behind the scenes, David&rsquo;s son Mitch Baney handles the
                business side of things — scheduling, estimates, and making
                sure every customer has a smooth experience from the first
                email to the final walk-through. It&rsquo;s a family operation
                in every sense.
              </p>
              <p>
                Forge Handyman Service is part of a growing family of local
                ventures built around the same principle: do honest work for
                your neighbors, and the business takes care of itself.
              </p>
            </div>
          </div>

          <aside className="space-y-5">
            <div className="rounded-xl border border-navy/10 bg-cream p-6">
              <p className="eyebrow">The Fast Facts</p>
              <dl className="mt-4 space-y-4 text-sm">
                <div className="flex items-start gap-3">
                  <Icon name="hammer" className="mt-0.5 h-5 w-5 text-amber-forge" />
                  <div>
                    <dt className="font-semibold text-navy">40+ Years Experience</dt>
                    <dd className="text-ink/70">Hands-on craftsmanship, not franchise training.</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Icon name="home" className="mt-0.5 h-5 w-5 text-amber-forge" />
                  <div>
                    <dt className="font-semibold text-navy">Locally Owned</dt>
                    <dd className="text-ink/70">Family-run, based right here in Garner, NC.</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Icon name="shield" className="mt-0.5 h-5 w-5 text-amber-forge" />
                  <div>
                    <dt className="font-semibold text-navy">Licensed &amp; Insured</dt>
                    <dd className="text-ink/70">Full coverage for your home and our work.</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Icon name="phone" className="mt-0.5 h-5 w-5 text-amber-forge" />
                  <div>
                    <dt className="font-semibold text-navy">One Point of Contact</dt>
                    <dd className="text-ink/70">
                      Call <a href={BUSINESS.phoneHref} className="font-semibold text-navy hover:text-amber-forge">{BUSINESS.phone}</a> and talk to someone real.
                    </dd>
                  </div>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </section>

      <section className="bg-cream">
        <div className="container-page section">
          <div className="mx-auto max-w-2xl text-center">
            <p className="eyebrow">Our Values</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
              The Four Things We Never Compromise On
            </h2>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {VALUES.map((value) => (
              <div
                key={value.title}
                className="rounded-xl border border-navy/10 bg-white p-6 shadow-card"
              >
                <h3 className="text-lg font-semibold text-navy">{value.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink/75">
                  {value.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white">
        <div className="container-page section">
          <div className="mx-auto max-w-3xl">
            <p className="eyebrow text-center">Why We&rsquo;re Different</p>
            <h2 className="mt-3 text-center text-3xl font-bold sm:text-4xl">
              Personal service, start to finish
            </h2>
            <ul className="mt-10 space-y-4">
              {[
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
              ].map((item) => (
                <li
                  key={item.title}
                  className="flex gap-4 rounded-xl border border-navy/10 bg-cream p-5"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-forge text-white">
                    <Icon name="check" className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-navy">
                      {item.title}
                    </h3>
                    <p className="mt-1 text-sm leading-relaxed text-ink/75">
                      {item.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
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
        heading="Meet the Craftsman in Your Driveway"
        subheading="Book a job with Forge and see the difference a 40-year veteran makes."
      />
    </>
  );
}
