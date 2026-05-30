"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BUSINESS } from "@/lib/constants";
import { Icon } from "@/lib/icons";

export function MobileCTA() {
  const pathname = usePathname();
  if (pathname?.startsWith("/contact")) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-card/95 p-3 backdrop-blur md:hidden"
      style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      role="region"
      aria-label="Quick contact"
    >
      <div className="flex gap-2">
        <a href={BUSINESS.phoneHref} className="btn-outline flex-1 text-sm">
          <Icon name="phone" className="h-4 w-4" />
          Call
        </a>
        <Link href="/contact" className="btn-primary flex-1 text-sm">
          <Icon name="calendar" className="h-4 w-4" />
          Book a Job
        </Link>
      </div>
    </div>
  );
}
