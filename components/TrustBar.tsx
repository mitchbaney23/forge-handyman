import { TRUST_SIGNALS } from "@/lib/constants";
import { Icon, type IconName } from "@/lib/icons";

export function TrustBar() {
  return (
    <section className="border-b border-navy/10 bg-white py-6">
      <div className="container-page">
        <ul className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 md:grid-cols-5">
          {TRUST_SIGNALS.map((signal) => (
            <li
              key={signal.label}
              className="flex items-center justify-center gap-2 text-navy/90"
            >
              <Icon
                name={signal.icon as IconName}
                className="h-5 w-5 flex-shrink-0 text-amber-forge"
              />
              <span className="font-semibold">{signal.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
