import Link from "next/link";
import type { Service } from "@/lib/constants";
import { Icon, type IconName } from "@/lib/icons";

type Props = {
  service: Service;
  variant?: "compact" | "full";
  index?: number;
};

export function ServiceCard({ service, variant = "compact", index }: Props) {
  const no =
    typeof index === "number"
      ? `№ ${String(index + 1).padStart(2, "0")}`
      : null;

  if (variant === "full") {
    return (
      <div className="group flex gap-[18px] rounded-lg border-2 border-ink bg-card p-6 shadow-card transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-card-hover">
        <div className="flex h-[50px] w-[50px] flex-none items-center justify-center rounded-lg bg-orange text-white">
          <Icon name={service.icon as IconName} className="h-[26px] w-[26px]" />
        </div>
        <div>
          <h3 className="font-display text-xl">{service.title}</h3>
          <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">
            {service.long}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-[7px] border-2 border-ink bg-card shadow-card transition-all duration-150 hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-card-hover">
      {/* Top strip */}
      <div className="flex items-center justify-between border-b-2 border-dashed border-line p-4">
        <div className="flex h-[46px] w-[46px] items-center justify-center rounded-md bg-orange text-white">
          <Icon name={service.icon as IconName} className="h-[25px] w-[25px]" />
        </div>
        {no && (
          <span className="font-sans text-[12px] font-bold tracking-[0.12em] text-ink-3">
            {no}
          </span>
        )}
      </div>
      {/* Body */}
      <div className="flex flex-1 flex-col p-[18px]">
        <h3 className="font-display text-xl">{service.title}</h3>
        <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-2">
          {service.short}
        </p>
        <Link
          href="/services"
          className="mt-4 inline-flex items-center gap-1.5 text-[13.5px] font-bold text-orange"
        >
          Learn more
          <Icon
            name="arrow-right"
            className="h-[15px] w-[15px] transition-transform duration-150 group-hover:translate-x-1"
          />
        </Link>
      </div>
    </div>
  );
}
