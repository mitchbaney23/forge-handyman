import Image from "next/image";
import Link from "next/link";

type LogoProps = {
  variant?: "light" | "dark";
};

export function Logo({ variant = "dark" }: LogoProps) {
  const isLight = variant === "light";

  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-2.5 sm:gap-3"
      aria-label="Forge Handyman Service — Home"
    >
      <Image
        src="/anvil.png"
        alt=""
        width={923}
        height={444}
        priority
        sizes="(max-width: 768px) 60px, 72px"
        className={`h-7 w-auto sm:h-8 md:h-10 ${isLight ? "brightness-0 invert" : ""}`}
      />
      <span className="flex flex-col leading-[0.95]">
        <span
          className="font-display text-2xl font-bold tracking-[0.02em] text-orange sm:text-[1.6rem] md:text-3xl"
        >
          FORGE
        </span>
        <span
          className={`font-sans text-[0.62rem] font-bold uppercase tracking-[0.16em] sm:text-[0.7rem] md:text-[0.78rem] ${
            isLight ? "text-paper" : "text-ink"
          }`}
        >
          Handyman Service
        </span>
      </span>
    </Link>
  );
}
