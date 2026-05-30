import Link from "next/link";
import { BUSINESS, NAV_LINKS } from "@/lib/constants";
import { Logo } from "@/components/Logo";
import { Icon } from "@/lib/icons";

export function Footer() {
  return (
    <footer className="border-t-2 border-ink bg-ink text-paper/[0.72]">
      <div className="container-page py-14">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <Logo variant="light" />
            <p className="mt-4 text-sm leading-relaxed text-paper/70">
              Honest work, fair prices, and a craftsman you can trust in your home.
              {" "}
              {BUSINESS.serviceAreaLine}.
            </p>
            <Link
              href="/contact"
              className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-ember hover:text-orange"
            >
              Request a free estimate
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </div>

          <div>
            <h4 className="font-display text-base font-bold text-paper">
              Contact
            </h4>
            <ul className="mt-4 space-y-3 text-sm">
              <li>
                <a
                  href={BUSINESS.phoneHref}
                  className="flex items-center gap-2 hover:text-ember"
                >
                  <Icon name="phone" className="h-4 w-4 text-ember" />
                  {BUSINESS.phone}
                </a>
              </li>
              <li>
                <a
                  href={BUSINESS.emailHref}
                  className="flex items-center gap-2 hover:text-ember"
                >
                  <Icon name="mail" className="h-4 w-4 text-ember" />
                  {BUSINESS.email}
                </a>
              </li>
              <li className="flex items-start gap-2">
                <Icon
                  name="clock"
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-ember"
                />
                <div>
                  {BUSINESS.hours.map((h) => (
                    <div key={h.day} className="text-paper/75">
                      <span className="text-paper">{h.day}:</span> {h.time}
                    </div>
                  ))}
                </div>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="font-display text-base font-bold text-paper">
              Quick Links
            </h4>
            <ul className="mt-4 space-y-2 text-sm">
              {NAV_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-paper/75 hover:text-ember"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-paper/[0.16] pt-6 text-xs text-paper/55 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Forge Handyman Service. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-ember">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-ember">
              Terms
            </Link>
            <span className="hidden sm:inline">Honest Work. Built to Last.</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
