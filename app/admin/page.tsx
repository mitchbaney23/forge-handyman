import type { Metadata } from "next";
import { JobCard } from "@/components/admin/JobCard";
import {
  crmEnabled,
  getCustomerStats,
  groupJobsForOverview,
  listJobs,
  type JobRow,
} from "@/lib/data";
import { ACTIONS } from "@/lib/data/activity-actions";
import { listJobIdsWithActionSince } from "@/lib/data/pg/activities-read";
import { listPaymentsSince } from "@/lib/data/pg/payments";
import {
  medianCycleDays,
  quoteConversion,
  revenueThisMonthCents,
  topLeadSources,
} from "@/lib/admin/metrics";

export const metadata: Metadata = {
  title: "Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminHomePage() {
  let jobs: JobRow[] = [];
  let loadError: string | null = null;
  try {
    jobs = await listJobs();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <div className="font-semibold">Couldn&rsquo;t load jobs from the sheet.</div>
        <div className="mt-2 font-mono text-xs">{loadError}</div>
      </div>
    );
  }

  const groups = groupJobsForOverview(jobs);

  // Customers stat is postgres-only (Stage 14 / Phase B). In sheet mode the
  // CRM surface has no backend, so we omit the card rather than show a zero.
  let customersStat: { label: string; value: string | number } | null = null;
  if (crmEnabled()) {
    const customerStats = await getCustomerStats();
    customersStat = { label: "Customers", value: customerStats.totalCustomers };
  }

  const stats: { label: string; value: string | number }[] = [
    { label: "Needs triage", value: groups.needsTriage.length },
    { label: "Today", value: groups.today.length },
    { label: "Tomorrow", value: groups.tomorrow.length },
    { label: "Open quotes", value: groups.openQuotes.length },
    ...(customersStat ? [customersStat] : []),
  ];

  // "How's business" band — postgres-only (payments ledger + activities), and
  // best-effort: a metrics failure must never take down the ops dashboard.
  let business: { label: string; value: string; hint: string }[] | null = null;
  if (crmEnabled()) {
    try {
      const now = new Date();
      const ninetyDaysAgo = new Date(
        now.getTime() - 90 * 24 * 60 * 60 * 1000,
      ).toISOString();
      // A 40-day payment window comfortably covers "this ET month".
      const fortyDaysAgo = new Date(
        now.getTime() - 40 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const [payments, quotedJobIds] = await Promise.all([
        listPaymentsSince(fortyDaysAgo),
        listJobIdsWithActionSince(ACTIONS.QUOTE_SENT, ninetyDaysAgo),
      ]);
      const revenue = revenueThisMonthCents(payments, now);
      const conversion = quoteConversion(quotedJobIds, jobs);
      const cycle = medianCycleDays(jobs, now);
      const sources = topLeadSources(jobs, now, 1);
      business = [
        {
          label: "Collected this month",
          value: `$${(revenue / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
          hint: "cash in − refunds out, this month",
        },
        {
          label: "Quote → paid (90d)",
          value:
            conversion.quoted > 0
              ? `${conversion.paid} of ${conversion.quoted} (${Math.round((conversion.paid / conversion.quoted) * 100)}%)`
              : "—",
          hint: "quotes sent that turned into deposits",
        },
        {
          label: "Lead → done (90d)",
          value: cycle !== null ? `${cycle} days` : "—",
          hint: "median, submitted to completed",
        },
        {
          label: "Top source (30d)",
          value:
            sources.length > 0 ? `${sources[0].source} · ${sources[0].count}` : "—",
          hint: "where leads came from",
        },
      ];
    } catch {
      business = null; // strip simply doesn't render; ops dashboard unaffected
    }
  }

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Overview</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy sm:text-3xl">
          What needs you today
        </h1>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-navy/10 bg-white p-4"
          >
            <div className="text-xs font-medium uppercase tracking-wide text-ink/55">
              {s.label}
            </div>
            <div className="mt-1 text-2xl font-semibold text-navy">{s.value}</div>
          </div>
        ))}
      </div>

      {business && (
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">
            How&rsquo;s business
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {business.map((s) => (
              <div
                key={s.label}
                className="rounded-lg border border-amber-200 bg-amber-50/50 p-4"
              >
                <div className="text-xs font-medium uppercase tracking-wide text-ink/55">
                  {s.label}
                </div>
                <div className="mt-1 text-2xl font-semibold text-navy">
                  {s.value}
                </div>
                <div className="mt-0.5 text-[11px] text-ink/45">{s.hint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Section
        title="Needs triage"
        subtitle="New submissions waiting for a reply or quote."
        jobs={groups.needsTriage}
        emptyMessage="Nothing waiting. Good shape."
      />

      <Section
        title="Today"
        subtitle="Booked or in-progress jobs scheduled for today."
        jobs={groups.today}
        emptyMessage="No jobs scheduled today."
      />

      <Section
        title="Tomorrow"
        subtitle="What David needs to know about for tomorrow."
        jobs={groups.tomorrow}
        emptyMessage="No jobs scheduled tomorrow."
      />

      <Section
        title="Open quotes"
        subtitle="Sent quotes still waiting on a deposit."
        jobs={groups.openQuotes}
        emptyMessage="No outstanding quotes."
      />

      <Section
        title="Recently completed"
        subtitle="Wrapped up in the last 7 days."
        jobs={groups.recentlyComplete}
        emptyMessage="No recent completes."
      />
    </div>
  );
}

function Section({
  title,
  subtitle,
  jobs,
  emptyMessage,
}: {
  title: string;
  subtitle: string;
  jobs: JobRow[];
  emptyMessage: string;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-semibold text-navy">
          {title}
          <span className="ml-2 text-sm font-normal text-ink/50">
            {jobs.length}
          </span>
        </h2>
        <p className="text-xs text-ink/55">{subtitle}</p>
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy/15 bg-white/50 p-6 text-center text-sm text-ink/55">
          {emptyMessage}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.map((job) => (
            <JobCard key={job.rowNumber} job={job} />
          ))}
        </div>
      )}
    </section>
  );
}
