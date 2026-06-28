import type { Metadata } from "next";
import { listJobs, type JobRow } from "@/lib/data";
import { PipelineBoard, type BoardJob } from "@/components/admin/PipelineBoard";

export const metadata: Metadata = {
  title: "Pipeline — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
        <div className="font-semibold">Couldn&rsquo;t load jobs.</div>
        <div className="mt-2 font-mono text-xs">{loadError}</div>
      </div>
    );
  }

  const boardJobs: BoardJob[] = jobs.map((j) => ({
    jobId: j.job_id || "",
    name: j.name || "",
    serviceType: j.service_type || "",
    status: j.status || "",
    submittedAt: j.submitted_at || "",
  }));

  // eslint-disable-next-line react-hooks/purity -- server component, runs per-request, Date.now is intentional
  const now = Date.now();

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Pipeline</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy sm:text-3xl">
          Where every job sits
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          Drag a card between columns to move a deal, or use{" "}
          <span className="font-medium text-ink/75">Move to…</span> on a card
          (handy on your phone). Stalled deals get a
          <span className="mx-1 inline-block rounded bg-amber-200 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
            stalled
          </span>
          badge. Oldest-first within each column.
        </p>
      </header>

      <PipelineBoard jobs={boardJobs} now={now} />
    </div>
  );
}
