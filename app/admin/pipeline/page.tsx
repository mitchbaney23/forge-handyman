import type { Metadata } from "next";
import Link from "next/link";
import { listJobs, type JobRow } from "@/lib/data";

export const metadata: Metadata = {
  title: "Pipeline — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

const COLUMNS: { status: string; matches: string[]; staleAfterHours: number }[] = [
  { status: "New", matches: ["New"], staleAfterHours: 24 },
  { status: "Quoted", matches: ["Quoted", "Pending Follow-Up"], staleAfterHours: 7 * 24 },
  { status: "Booked", matches: ["Booked"], staleAfterHours: 14 * 24 },
  { status: "In Progress", matches: ["In Progress"], staleAfterHours: 48 },
  { status: "Complete", matches: ["Complete"], staleAfterHours: 365 * 24 },
];

export default async function PipelinePage() {
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

  // eslint-disable-next-line react-hooks/purity -- server component, runs per-request, Date.now is intentional
  const now = Date.now();
  const grouped = COLUMNS.map((col) => {
    const inCol = jobs.filter((j) => col.matches.includes(j.status));
    // Oldest first — stalled jobs surface to the top.
    inCol.sort((a, b) => (a.submitted_at || "").localeCompare(b.submitted_at || ""));
    return { ...col, jobs: inCol };
  });

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Pipeline</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy sm:text-3xl">
          Where every job sits
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          Stalled jobs (older than the per-column threshold) get a
          <span className="mx-1 inline-block rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
            stalled
          </span>
          badge. Oldest-first within each column.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        {grouped.map((col) => (
          <PipelineColumn key={col.status} {...col} now={now} />
        ))}
      </div>
    </div>
  );
}

function PipelineColumn({
  status,
  jobs,
  staleAfterHours,
  now,
}: {
  status: string;
  jobs: JobRow[];
  staleAfterHours: number;
  now: number;
}) {
  return (
    <div className="rounded-xl border border-navy/10 bg-navy/[0.03] p-3">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-navy">{status}</h2>
        <span className="text-xs font-medium text-ink/55">{jobs.length}</span>
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-navy/15 bg-white/50 p-4 text-center text-xs text-ink/50">
          Empty
        </div>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => (
            <PipelineCard
              key={job.rowNumber}
              job={job}
              now={now}
              staleAfterHours={staleAfterHours}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineCard({
  job,
  now,
  staleAfterHours,
}: {
  job: JobRow;
  now: number;
  staleAfterHours: number;
}) {
  const submittedAt = job.submitted_at ? new Date(job.submitted_at).getTime() : 0;
  const ageHours = submittedAt ? Math.floor((now - submittedAt) / 3_600_000) : 0;
  const isStale = submittedAt > 0 && ageHours > staleAfterHours;

  return (
    <Link
      href={`/admin/jobs/${encodeURIComponent(job.job_id || "")}`}
      className={`block rounded-lg border bg-white p-3 transition-colors hover:border-navy/30 ${
        isStale ? "border-amber-300" : "border-navy/10"
      }`}
    >
      <div className="truncate text-sm font-semibold text-navy">
        {job.name || "(no name)"}
      </div>
      <div className="mt-0.5 truncate text-xs text-ink/60">
        {job.service_type}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-ink/55">
        <span>{formatAge(ageHours)}</span>
        {isStale && (
          <span className="rounded bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-900">
            stalled
          </span>
        )}
      </div>
    </Link>
  );
}

function formatAge(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d old`;
  return `${Math.floor(days / 30)}mo old`;
}
