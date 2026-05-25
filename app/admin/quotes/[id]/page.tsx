import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteComposer } from "./QuoteComposer";
import { findRowByJobId } from "@/lib/sheet/repo";

export const metadata: Metadata = {
  title: "Send Quote — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const found = await findRowByJobId(decoded);
  if (!found) notFound();
  const { row } = found;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link
          href={`/admin/jobs/${decoded}`}
          className="text-xs font-medium text-ink/60 hover:text-navy"
        >
          ← Back to job
        </Link>
      </div>

      <header>
        <p className="eyebrow">Quote</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy">
          Send a Payment Link
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          Generates a Stripe Payment Link and emails it to the customer. The
          deposit charges when they pay, saves their card on file, and flips
          this job&rsquo;s status to <strong>Quoted</strong>. The balance
          auto-charges later when you Mark Complete.
        </p>
      </header>

      <QuoteComposer
        jobId={decoded}
        customerName={row.name || ""}
        customerEmail={row.email || ""}
        serviceType={row.service_type || ""}
        initialDescription={row.description || ""}
      />
    </div>
  );
}
