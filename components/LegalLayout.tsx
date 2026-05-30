import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";

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
      <PageHeader stamp={eyebrow} title={title}>
        <span className="text-[15px] text-ink-3">Last updated: {lastUpdated}</span>
      </PageHeader>
      <section className="section-tight">
        <div className="container-page">
          <div className="mx-auto max-w-[780px] [&_a]:text-orange [&_a]:underline [&_a]:underline-offset-[3px] [&_h2:first-of-type]:mt-6 [&_h2:first-of-type]:border-t-0 [&_h2:first-of-type]:pt-0 [&_h2]:mt-[38px] [&_h2]:border-t-2 [&_h2]:border-dashed [&_h2]:border-line [&_h2]:pt-[22px] [&_h2]:font-display [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:text-ink [&_h3]:mt-[22px] [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-bold [&_li]:mt-2 [&_li]:text-base [&_li]:text-ink-2 [&_p]:mt-3.5 [&_p]:text-base [&_p]:leading-[1.7] [&_p]:text-ink-2 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-[22px]">
            {children}
          </div>
        </div>
      </section>
    </>
  );
}
