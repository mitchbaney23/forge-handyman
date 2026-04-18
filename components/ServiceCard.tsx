import Link from "next/link";
import type { Service } from "@/lib/constants";
import { Icon, type IconName } from "@/lib/icons";

type Props = {
  service: Service;
  variant?: "compact" | "full";
};

export function ServiceCard({ service, variant = "compact" }: Props) {
  return (
    <div className="group flex h-full flex-col rounded-xl border border-navy/10 bg-white p-6 shadow-card transition-all hover:-translate-y-0.5 hover:border-amber-forge/40 hover:shadow-card-hover">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-navy/5 text-navy transition-colors group-hover:bg-amber-forge group-hover:text-white">
        <Icon name={service.icon as IconName} className="h-6 w-6" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-navy">{service.title}</h3>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-ink/75">
        {variant === "full" ? service.long : service.short}
      </p>
      {variant === "compact" && (
        <Link
          href="/services"
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-amber-forge hover:text-amber-forge-dark"
        >
          Learn more
          <Icon name="arrow-right" className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
