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
      className={`sticky top-0 z-50 w-full transition-colors ${
        scrolled
          ? "border-b border-navy/10 bg-white/95 backdrop-blur"
          : "bg-white"
      }`}
    >
      <div className="hidden w-full bg-navy text-xs text-white/80 md:block">
        <div className="container-page flex h-9 items-center justify-between">
          <span className="flex items-center gap-2">
            <Icon name="map-pin" className="h-3.5 w-3.5 text-amber-forge-light" />
            Serving Garner, Clayton & South Raleigh, NC
          </span>
          <span className="flex items-center gap-5">
            <a href={BUSINESS.phoneHref} className="hover:text-amber-forge-light">
              {BUSINESS.phone}
            </a>
            <a href={BUSINESS.emailHref} className="hover:text-amber-forge-light">
              {BUSINESS.email}
            </a>
          </span>
        </div>
      </div>
      <div className="container-page flex h-16 items-center justify-between md:h-20">
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
                className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "text-amber-forge"
                    : "text-ink/80 hover:text-navy"
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
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-navy/15 text-navy md:hidden"
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
          className="fixed inset-x-0 top-16 z-40 border-t border-navy/10 bg-white shadow-lg md:hidden"
        >
          <nav className="container-page flex flex-col py-4" aria-label="Mobile">
            {NAV_LINKS.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-lg px-3 py-3 text-base font-medium ${
                    active
                      ? "bg-navy/5 text-amber-forge"
                      : "text-ink/80"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="mt-3 flex flex-col gap-2 border-t border-navy/10 pt-4">
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
