import type { ReactNode } from "react";

type Props = {
  stamp: string;
  title: string;
  children?: ReactNode;
};

/**
 * Interior page header band — kraft "shop ticket" header used by
 * Services / About / Contact / Legal. `bg-card` with a 2px ink base
 * rule and a faint paper-dot texture.
 */
export function PageHeader({ stamp, title, children }: Props) {
  return (
    <section className="relative overflow-hidden border-b-2 border-ink bg-card">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-paper-dots opacity-50"
        style={{ backgroundSize: "5px 5px" }}
      />
      <div className="container-page relative py-[60px] pb-16">
        <span className="stamp">{stamp}</span>
        <h1 className="mt-4 max-w-[18ch] font-display text-[clamp(38px,5vw,58px)] font-bold leading-[1.02] text-ink">
          {title}
        </h1>
        {children && (
          <div className="mt-4 max-w-[60ch] text-lg text-ink-2">{children}</div>
        )}
      </div>
    </section>
  );
}
