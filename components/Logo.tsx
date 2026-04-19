import Image from "next/image";
import Link from "next/link";

type LogoProps = {
  variant?: "light" | "dark";
};

export function Logo({ variant = "dark" }: LogoProps) {
  if (variant === "light") {
    return <LightFallback />;
  }

  return (
    <Link
      href="/"
      className="inline-flex items-center"
      aria-label="Forge Handyman Service — Home"
    >
      <Image
        src="/logo.png"
        alt="Forge Handyman Service"
        width={1536}
        height={1024}
        priority
        sizes="(max-width: 768px) 120px, 170px"
        className="h-11 w-auto md:h-14"
      />
    </Link>
  );
}

function LightFallback() {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-3"
      aria-label="Forge Handyman Service — Home"
    >
      <span className="grid h-10 w-10 place-items-center rounded-lg bg-white/10 transition-transform group-hover:-rotate-6">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5 text-amber-forge-light"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m14 3 7 7-4 4-7-7 4-4z" />
          <path d="m10 10-7 7 3 3 7-7" />
        </svg>
      </span>
      <span className="flex flex-col leading-none">
        <span className="text-base font-bold tracking-tight text-white">
          Forge Handyman
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
          Service
        </span>
      </span>
    </Link>
  );
}
