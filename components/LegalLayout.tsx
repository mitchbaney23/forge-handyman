import type { ReactNode } from "react";

export function LegalLayout({
  eyebrow,
  title,
  lastUpdated,
  children,
}: {
  eyebrow: string;
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <>
      <section className="texture-navy text-white">
        <div className="container-page py-12 sm:py-16">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-forge-light">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm text-white/70">Last updated: {lastUpdated}</p>
        </div>
      </section>
      <section className="section-tight">
        <div className="container-page">
          <div className="mx-auto max-w-3xl text-[15px] [&_a]:text-amber-forge [&_a]:underline hover:[&_a]:text-navy [&_h2]:mb-3 [&_h2]:mt-9 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-navy [&_li]:mb-1.5 [&_p]:mb-4 [&_p]:leading-relaxed [&_p]:text-ink/80 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:text-ink/80 first:[&_h2]:mt-0">
            {children}
          </div>
        </div>
      </section>
    </>
  );
}
