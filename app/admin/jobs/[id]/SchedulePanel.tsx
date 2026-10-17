"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/guard";
import {
  DEFAULT_SCHEDULE,
  ScheduleFields,
  type ScheduleValue,
} from "@/components/admin/ScheduleFields";
import { scheduleJobAction } from "./actions";

// "Schedule" on a job with no appointment: date, start time, length. Books it
// on the operations calendar and moves the job to Booked.
export function SchedulePanel({ jobId, calendarEmail }: { jobId: string; calendarEmail: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState<ScheduleValue>(DEFAULT_SCHEDULE);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await scheduleJobAction(jobId, when);
      setResult(res);
      if (res.ok) router.refresh();
    });
  };

  if (result?.ok) {
    return <p className="text-sm text-green-700">{result.message}</p>;
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-ink/70">No appointment booked yet.</p>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy hover:text-white"
        >
          Schedule it
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <ScheduleFields value={when} onChange={setWhen} calendarEmail={calendarEmail} narrow />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className="btn-primary text-sm">
          {pending ? "Scheduling…" : "Schedule"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          disabled={pending}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm text-ink/70 hover:bg-navy/5 disabled:opacity-50"
        >
          Never mind
        </button>
      </div>
      {result && !result.ok && <p className="text-sm text-red-700">{result.error}</p>}
    </form>
  );
}
