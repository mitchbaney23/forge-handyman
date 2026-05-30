import Link from "next/link";
import { Icon } from "@/lib/icons";

export default function NotFound() {
  return (
    <section className="bg-paper">
      <div className="container-page flex min-h-[60vh] flex-col items-center justify-center px-6 py-20 text-center">
        <div className="font-display text-[clamp(80px,16vw,160px)] font-bold leading-[0.9] text-orange">
          404
        </div>
        <h1 className="mt-2 font-display text-[clamp(28px,4vw,40px)] font-bold">
          This page took the day off
        </h1>
        <p className="mx-auto mt-4 max-w-[42ch] text-[17px] text-ink-2">
          We couldn&rsquo;t find what you were looking for — but David&rsquo;s
          still on the tools. Let&rsquo;s get you back to something useful.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3.5 sm:flex-row">
          <Link href="/" className="btn-primary">
            Back to Home
            <Icon name="arrow-right" className="h-4 w-4" />
          </Link>
          <Link href="/contact" className="btn-outline">
            Book a Job
          </Link>
        </div>
      </div>
    </section>
  );
}
