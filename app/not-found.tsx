import Link from "next/link";
import { Icon } from "@/lib/icons";

export default function NotFound() {
  return (
    <section className="bg-cream">
      <div className="container-page section text-center">
        <p className="eyebrow">404</p>
        <h1 className="mt-3 text-4xl font-bold sm:text-5xl">
          This page is off the map.
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-base text-ink/70">
          The page you&rsquo;re looking for doesn&rsquo;t exist — but we can still fix what&rsquo;s broken.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
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
