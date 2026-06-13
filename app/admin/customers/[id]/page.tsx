import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityTimeline } from "@/components/admin/ActivityTimeline";
import { CustomerHeader } from "@/components/admin/CustomerHeader";
import { JobCard } from "@/components/admin/JobCard";
import { PropertiesSection } from "@/components/admin/PropertiesSection";
import {
  crmEnabled,
  getCustomerById,
  listActivitiesForJob,
  type Activity,
  type CustomerDetail,
} from "@/lib/data";
import { updateStandingNotes } from "./actions";

export const metadata: Metadata = {
  title: "Customer · Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CustomerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const customerId = decodeURIComponent(id);

  // Postgres-only surface. In sheet mode there's no customers table to read —
  // show the same honest notice the list page uses, not an error or notFound.
  if (!crmEnabled()) {
    return (
      <div className="space-y-8">
        <div>
          <Link
            href="/admin/customers"
            className="text-xs font-medium text-ink/60 hover:text-navy"
          >
            ← Back to customers
          </Link>
        </div>
        <header>
          <p className="eyebrow">Customer</p>
          <h1 className="mt-1 text-2xl font-semibold text-navy sm:text-3xl">
            Customer profile
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

  let customer: CustomerDetail | null = null;
  let loadError: string | null = null;
  try {
    customer = await getCustomerById(customerId);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <div className="font-semibold">Couldn&rsquo;t load this customer.</div>
        <div className="mt-2 font-mono text-xs">{loadError}</div>
      </div>
    );
  }

  if (!customer) notFound();

  // Aggregate the timeline across the customer's jobs: one listActivitiesForJob
  // call per job (each is uuid-gated and ordered at-desc), concatenated and
  // re-sorted at-desc so the profile reads as one chronological history. N here
  // is one customer's jobs — small — so the per-job fan-out is acceptable; if a
  // landlord ever accumulates a very large job count this would warrant a
  // dedicated "activities by customer" read, noted in the report.
  const jobIds = customer.jobs
    .map((job) => job.job_id ?? "")
    .filter((jobId) => jobId !== "");
  const activityLists = await Promise.all(
    jobIds.map((jobId) => listActivitiesForJob(jobId)),
  );
  const activities: Activity[] = activityLists
    .flat()
    // at is an ISO string ('' when absent); lexicographic compare sorts the
    // most-recent first and pushes empty timestamps to the bottom.
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  // Bind the customer id into the standing-notes action so EditNotesForm (via
  // CustomerHeader) only supplies the notes text — matching its SaveNotesAction
  // signature.
  const cid = customer.id;
  async function saveNotesAction(
    notes: string,
  ): Promise<{ updated: boolean; error?: string }> {
    "use server";
    return updateStandingNotes(cid, notes);
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/customers"
          className="text-xs font-medium text-ink/60 hover:text-navy"
        >
          ← Back to customers
        </Link>
      </div>

      <CustomerHeader customer={customer} saveNotesAction={saveNotesAction} />

      <PropertiesSection properties={customer.properties} />

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-navy">
            Jobs
            <span className="ml-2 text-sm font-normal text-ink/50">
              {customer.jobs.length}
            </span>
          </h2>
        </div>
        {customer.jobs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-navy/15 bg-white/50 p-6 text-center text-sm text-ink/55">
            No jobs on file yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {customer.jobs.map((job) => (
              <JobCard key={job.rowNumber} job={job} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-navy">Activity</h2>
          <p className="text-xs text-ink/55">
            Everything that&rsquo;s happened across this customer&rsquo;s jobs.
          </p>
        </div>
        <ActivityTimeline activities={activities} />
      </section>
    </div>
  );
}
