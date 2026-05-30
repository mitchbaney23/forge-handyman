import { TRUST_SIGNALS } from "@/lib/constants";
import { Icon, type IconName } from "@/lib/icons";

export function TrustBar() {
  // Duplicate the list so the translateX(-50%) loop is seamless.
  const items = [...TRUST_SIGNALS, ...TRUST_SIGNALS];

  return (
    <section className="overflow-hidden border-y-2 border-ink bg-ink text-paper">
      <div className="marquee-track flex w-max whitespace-nowrap">
        {items.map((signal, i) => (
          <span
            key={`${signal.label}-${i}`}
            className="flex items-center gap-3 px-[30px] py-4 font-display text-[17px] font-semibold"
          >
            <Icon
              name={signal.icon as IconName}
              className="h-5 w-5 flex-shrink-0 text-ember"
            />
            {signal.label}
            <span className="ml-3 text-[20px] text-orange" aria-hidden="true">
              ✦
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}
