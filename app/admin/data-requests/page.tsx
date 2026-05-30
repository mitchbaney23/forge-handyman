import type { Metadata } from "next";
import Link from "next/link";
import { DataRequestForm } from "./DataRequestForm";

export const metadata: Metadata = {
  title: "Data requests — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function DataRequestsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-xs font-medium text-ink/60 hover:text-navy"
        >
          ← Back to overview
        </Link>
      </div>

      <header>
        <p className="eyebrow">Privacy</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy">
          Customer data requests
        </h1>
        <p className="mt-2 text-sm text-ink/65">
          Honor a customer&rsquo;s right-to-be-forgotten request. Anonymization
          is logged to the Audit tab. For the full policy, see{" "}
          <code className="rounded bg-navy/5 px-1 text-xs">docs/data-retention.md</code>.
        </p>
      </header>

      <DataRequestForm />
    </div>
  );
}
