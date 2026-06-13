import type { Metadata } from "next";
import { CustomerTable } from "@/components/admin/CustomerTable";
import { crmEnabled, listCustomers, type CustomerSummary } from "@/lib/data";

export const metadata: Metadata = {
  title: "Customers · Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CustomersPage() {
  // Postgres-only surface. In sheet mode there's no customers table to read —
  // show an honest notice rather than an empty table or an error.
  if (!crmEnabled()) {
    return (
      <div className="space-y-8">
        <header>
          <p className="eyebrow">Customers</p>
          <h1 className="mt-1 text-2xl font-semibold text-navy sm:text-3xl">
            Customer profiles
          </h1>
        </header>
        <div className="rounded-lg border border-navy/15 bg-white/60 p-6 text-sm text-ink/70">
          <div className="font-semibold text-navy">
            Available once you&rsquo;re on Postgres
          </div>
          <p className="mt-2">
            Customer profiles are available once you&rsquo;re on the Postgres
            backend — see the cutover runbook.
          </p>
        </div>
      </div>
    );
  }

  let customers: CustomerSummary[] = [];
  let loadError: string | null = null;
  try {
    customers = await listCustomers();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <div className="font-semibold">Couldn&rsquo;t load customers.</div>
        <div className="mt-2 font-mono text-xs">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Customers</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy sm:text-3xl">
          Customer profiles
        </h1>
      </header>

      <CustomerTable customers={customers} />
    </div>
  );
}
