import Link from "next/link";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { JobRow } from "@/lib/sheet/queries";

export function JobCard({ job }: { job: JobRow }) {
  const submittedRelative = formatRelative(job.submitted_at);
  return (
    <Link
      href={`/admin/jobs/${encodeURIComponent(job.job_id || "")}`}
      className="block rounded-lg border border-navy/10 bg-white p-4 shadow-sm transition-colors hover:border-navy/30"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-navy">
            {job.name || "(no name)"}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink/60">
            {job.service_type} · {formatDate(job.preferred_date)}
          </div>
          <div className="mt-1 truncate text-xs text-ink/55">{job.address}</div>
        </div>
        <StatusBadge status={job.status} />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-ink/55">
        <span>Submitted {submittedRelative}</span>
        {job.balance_owed_cents && Number(job.balance_owed_cents) > 0 && (
          <span className="font-medium text-amber-forge">
            ${(Number(job.balance_owed_cents) / 100).toFixed(2)} balance
          </span>
        )}
      </div>
    </Link>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatRelative(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!then) return iso;
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
