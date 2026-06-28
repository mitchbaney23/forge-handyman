"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  PIPELINE_COLUMNS,
  type PipelineColumnDef,
} from "@/lib/jobs/pipeline-columns";
import { canAdminTransition, statusOptionsFor } from "@/lib/jobs/status-machine";
import { moveDealAction } from "@/app/admin/pipeline/actions";

// The minimal per-deal shape the board needs (mapped from JobRow on the server).
export interface BoardJob {
  jobId: string;
  name: string;
  serviceType: string;
  status: string;
  submittedAt: string; // ISO or ''
}

interface Toast {
  kind: "ok" | "err";
  text: string;
}

// The drag payload, JSON in dataTransfer. `from` lets the drop target validate
// the transition (canAdminTransition) without a lookup.
interface DragData {
  jobId: string;
  from: string;
}

export function PipelineBoard({ jobs, now }: { jobs: BoardJob[]; now: number }) {
  // The board owns the live status of each deal so a move re-groups instantly
  // (optimistic). On a failed server action we revert to the snapshot.
  const [board, setBoard] = useState<BoardJob[]>(jobs);
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const [dragOverCol, setDragOverCol] = useState<number | null>(null);
  const draggingJobId = useRef<string | null>(null);

  // Sync to fresh server data when it genuinely changes (a revalidate after a
  // move, navigation, or an external change in another tab). React's blessed
  // "adjust state during render" idiom — `jobs` keeps a stable reference across
  // local re-renders (drag/menu/toast), so this only fires on a real new list,
  // never clobbering optimistic state mid-interaction.
  const [seenJobs, setSeenJobs] = useState(jobs);
  if (jobs !== seenJobs) {
    setSeenJobs(jobs);
    setBoard(jobs);
  }

  // Auto-dismiss the toast so it doesn't linger.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const grouped = useMemo(
    () =>
      PIPELINE_COLUMNS.map((col) => {
        const inCol = board.filter((j) => col.matches.includes(j.status));
        // Oldest first — stalled deals surface to the top, matching the old view.
        inCol.sort((a, b) => (a.submittedAt || "").localeCompare(b.submittedAt || ""));
        return { col, jobs: inCol };
      }),
    [board],
  );

  function performMove(jobId: string, from: string, to: string) {
    if (from === to) return;
    if (!canAdminTransition(from, to)) {
      setToast({ kind: "err", text: `Can’t move “${from}” → “${to}”.` });
      return;
    }
    const snapshot = board;
    // Optimistic: re-group immediately.
    setBoard((prev) =>
      prev.map((j) => (j.jobId === jobId ? { ...j, status: to } : j)),
    );
    startTransition(async () => {
      const res = await moveDealAction(jobId, to);
      if (res.ok) {
        setToast({ kind: "ok", text: res.message ?? `Moved to ${to}.` });
      } else {
        setBoard(snapshot); // revert
        setToast({ kind: "err", text: res.error });
      }
    });
  }

  function handleDrop(colIndex: number, col: PipelineColumnDef) {
    setDragOverCol(null);
    const jobId = draggingJobId.current;
    draggingJobId.current = null;
    if (!jobId) return;
    const job = board.find((j) => j.jobId === jobId);
    if (!job) return;
    if (col.dropStatus === null) {
      setToast({
        kind: "err",
        text: "Open the job and use “Mark Complete” — it charges the saved-card balance.",
      });
      return;
    }
    performMove(jobId, job.status, col.dropStatus);
  }

  return (
    <div>
      <div className="grid gap-4 lg:grid-cols-5">
        {grouped.map(({ col, jobs: colJobs }, colIndex) => {
          const isDropTarget = dragOverCol === colIndex;
          const droppable = col.dropStatus !== null;
          return (
            <div
              key={col.status}
              onDragOver={(e) => {
                // Allow a drop only onto droppable columns.
                if (!droppable) return;
                e.preventDefault();
                if (dragOverCol !== colIndex) setDragOverCol(colIndex);
              }}
              onDragLeave={(e) => {
                // Ignore leaves into child elements.
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                if (dragOverCol === colIndex) setDragOverCol(null);
              }}
              onDrop={() => handleDrop(colIndex, col)}
              className={`rounded-xl border p-3 transition-colors ${
                isDropTarget
                  ? "border-amber-forge bg-amber-forge/[0.06]"
                  : "border-navy/10 bg-navy/[0.03]"
              }`}
            >
              <div className="mb-3 flex items-center justify-between px-1">
                <h2 className="text-sm font-semibold text-navy">{col.status}</h2>
                <span className="text-xs font-medium text-ink/55">
                  {colJobs.length}
                </span>
              </div>
              {colJobs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-navy/15 bg-white/50 p-4 text-center text-xs text-ink/50">
                  {isDropTarget ? "Drop here" : "Empty"}
                </div>
              ) : (
                <div className="space-y-2">
                  {colJobs.map((job) => (
                    <PipelineCard
                      key={job.jobId}
                      job={job}
                      now={now}
                      staleAfterHours={col.staleAfterHours}
                      disabled={pending}
                      onDragStart={() => {
                        draggingJobId.current = job.jobId;
                      }}
                      onDragEnd={() => {
                        draggingJobId.current = null;
                        setDragOverCol(null);
                      }}
                      onMove={(to) => performMove(job.jobId, job.status, to)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border px-4 py-2.5 text-sm shadow-card ${
            toast.kind === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function PipelineCard({
  job,
  now,
  staleAfterHours,
  disabled,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  job: BoardJob;
  now: number;
  staleAfterHours: number;
  disabled: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (to: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const submittedAt = job.submittedAt ? new Date(job.submittedAt).getTime() : 0;
  const ageHours = submittedAt ? Math.floor((now - submittedAt) / 3_600_000) : 0;
  const isStale = submittedAt > 0 && ageHours > staleAfterHours;

  // The granular targets the move menu offers (current status excluded).
  const moveTargets = statusOptionsFor(job.status).filter((s) => s !== job.status);

  return (
    <div
      draggable={!disabled}
      onDragStart={(e) => {
        const data: DragData = { jobId: job.jobId, from: job.status };
        e.dataTransfer.setData("text/plain", JSON.stringify(data));
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      className={`group rounded-lg border bg-white p-3 ${
        disabled ? "opacity-60" : "cursor-grab active:cursor-grabbing"
      } ${isStale ? "border-amber-300" : "border-navy/10"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/admin/jobs/${encodeURIComponent(job.jobId)}`}
          className="min-w-0 flex-1"
          draggable={false}
        >
          <div className="truncate text-sm font-semibold text-navy hover:underline">
            {job.name || "(no name)"}
          </div>
          <div className="mt-0.5 truncate text-xs text-ink/60">
            {job.serviceType}
          </div>
        </Link>
        <span
          aria-hidden="true"
          className="select-none pt-0.5 text-ink/25"
          title="Drag to move"
        >
          ⠿
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-ink/55">
        <span>{formatAge(ageHours)}</span>
        {isStale && (
          <span className="rounded bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-900">
            stalled
          </span>
        )}
      </div>

      {/* Tap-to-move — the phone-friendly path (drag is awkward on touch). */}
      {moveTargets.length > 0 && (
        <div className="relative mt-2 border-t border-navy/5 pt-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMenuOpen((o) => !o)}
            className="text-[11px] font-medium text-ink/55 hover:text-navy disabled:opacity-50"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            Move to… ▾
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] rounded-lg border border-navy/15 bg-white py-1 shadow-card"
            >
              {moveTargets.map((target) => (
                <button
                  key={target}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onMove(target);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-xs text-ink/80 hover:bg-cream/50 hover:text-navy"
                >
                  {target}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatAge(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d old`;
  return `${Math.floor(days / 30)}mo old`;
}
