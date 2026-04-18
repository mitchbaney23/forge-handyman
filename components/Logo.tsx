import Link from "next/link";

type LogoProps = {
  variant?: "light" | "dark";
};

export function Logo({ variant = "dark" }: LogoProps) {
  const markColor = variant === "light" ? "text-amber-forge-light" : "text-amber-forge";
  const textColor = variant === "light" ? "text-white" : "text-navy";
  const subColor = variant === "light" ? "text-white/60" : "text-ink/55";

  return (
    <Link href="/" className="group inline-flex items-center gap-3" aria-label="Forge Handyman Service — Home">
      <span
        className={`grid h-10 w-10 place-items-center rounded-lg ${
          variant === "light" ? "bg-white/10" : "bg-navy"
        } transition-transform group-hover:-rotate-6`}
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-5 w-5 ${markColor}`}
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
        <span className={`text-base font-bold tracking-tight ${textColor}`}>
          Forge Handyman
        </span>
        <span className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${subColor}`}>
          Service
        </span>
      </span>
    </Link>
  );
}
