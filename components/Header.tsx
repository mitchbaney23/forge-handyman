"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BUSINESS, NAV_LINKS } from "@/lib/constants";
import { Logo } from "@/components/Logo";
import { Icon } from "@/lib/icons";

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing menu on route change is the correct effect
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b-2 border-ink bg-paper transition-shadow ${
        scrolled ? "shadow-[0_8px_24px_rgba(36,33,27,.12)]" : ""
      }`}
    >
      <div className="hidden w-full bg-ink text-xs text-paper md:block">
        <div className="container-page flex h-10 items-center justify-between">
          <span className="flex items-center gap-2">
            <Icon name="map-pin" className="h-3.5 w-3.5 text-ember" />
            Serving Garner, Raleigh, Cary & nearby, NC
          </span>
          <span className="flex items-center gap-5">
            <a href={BUSINESS.phoneHref} className="hover:text-ember">
              {BUSINESS.phone}
            </a>
            <a href={BUSINESS.emailHref} className="hover:text-ember">
              {BUSINESS.email}
            </a>
          </span>
        </div>
      </div>
      <div className="container-page flex h-16 items-center justify-between md:h-[74px]">
        <Logo />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-2 text-[14.5px] font-semibold transition-colors ${
                  active ? "text-orange" : "text-ink-2 hover:text-orange"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <Link href="/contact" className="btn-primary ml-3">
            Book a Job
          </Link>
        </nav>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex h-11 w-11 items-center justify-center rounded-[3px] border-2 border-ink text-ink md:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
        >
          <Icon name={open ? "close" : "menu"} className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div
          id="mobile-menu"
          className="fixed inset-x-0 top-16 z-40 border-l-2 border-ink bg-card shadow-lg md:hidden"
        >
          <nav className="container-page flex flex-col py-2" aria-label="Mobile">
            {NAV_LINKS.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`border-b border-line px-3 py-4 font-display text-[21px] ${
                    active ? "text-orange" : "text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="mt-4 flex flex-col gap-2 pt-2">
              <a href={BUSINESS.phoneHref} className="btn-outline">
                <Icon name="phone" className="h-4 w-4" />
                {BUSINESS.phone}
              </a>
              <Link href="/contact" className="btn-primary">
                Book a Job
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
