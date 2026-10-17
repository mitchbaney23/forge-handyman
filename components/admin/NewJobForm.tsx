"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EMPTY_JOB_FIELDS, JobFields, type JobFieldsValue } from "@/components/admin/JobFields";
import {
  DEFAULT_SCHEDULE,
  ScheduleFields,
  type ScheduleValue,
} from "@/components/admin/ScheduleFields";
import type {
  CreateJobActionResult,
  NewJobFormInput,
} from "@/app/admin/customers/form-types";

// Bound to one customer by the profile page.
export type CreateJobAction = (input: NewJobFormInput) => Promise<CreateJobActionResult>;

// "+ New job" on the customer page: the job fields, plus an optional
// "Schedule it now" section that books the time and puts it on the
// operations Google Calendar. Times are Eastern (the server converts them).
export function NewJobForm({
  action,
  addressSuggestions,
  calendarEmail,
}: {
  action: CreateJobAction;
  addressSuggestions: string[];
  calendarEmail: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateJobActionResult | null>(null);

  const initialJob: JobFieldsValue = {
    ...EMPTY_JOB_FIELDS,
    // One property on file: that's almost certainly where the new job is.
    address: addressSuggestions.length === 1 ? addressSuggestions[0] : "",
  };
  const [job, setJob] = useState<JobFieldsValue>(initialJob);
  const [withSchedule, setWithSchedule] = useState(false);
  const [when, setWhen] = useState<ScheduleValue>(DEFAULT_SCHEDULE);

  const reset = () => {
    setJob(initialJob);
    setWithSchedule(false);
    setWhen(DEFAULT_SCHEDULE);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await action({
        serviceType: job.serviceType,
        address: job.address || undefined,
        description: job.description || undefined,
        preferredDate: job.preferredDate || undefined,
        urgency: job.urgency || undefined,
        schedule: withSchedule ? when : undefined,
      });
      setResult(res);
      if (res.ok) {
        reset();
        setOpen(false);
        router.refresh();
      }
    });
  };

  const done = result?.ok ? result : null;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setResult(null);
          }}
          className="btn-primary text-sm"
        >
          + New job
        </button>
        {done && (
          <span className={`text-sm ${done.scheduleError ? "text-amber-800" : "text-emerald-700"}`}>
            {done.message}{" "}
            <Link
              href={`/admin/jobs/${encodeURIComponent(done.jobId)}`}
              className="font-medium underline hover:text-navy"
            >
              Open the job
            </Link>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-navy/10 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/60">New job</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="text-xs font-medium text-ink/55 hover:text-navy"
        >
          Close
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <JobFields
          value={job}
          onChange={setJob}
          required
          addressSuggestions={addressSuggestions}
          showPreferredDate={!withSchedule}
          idPrefix="new-job"
        />

        <label className="flex items-center gap-2 text-sm text-ink/80">
          <input
            type="checkbox"
            checked={withSchedule}
            onChange={(e) => setWithSchedule(e.target.checked)}
            className="h-4 w-4 rounded border-navy/30 text-amber-forge focus:ring-amber-forge/40"
          />
          Schedule it now
        </label>

        {withSchedule && (
          <div className="rounded-lg border border-navy/10 bg-cream/30 p-4">
            <ScheduleFields value={when} onChange={setWhen} calendarEmail={calendarEmail} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary text-sm">
            {pending ? "Saving…" : withSchedule ? "Add job + schedule" : "Add job"}
          </button>
          {result && !result.ok && <span className="text-sm text-red-700">{result.error}</span>}
        </div>
      </form>
    </div>
  );
}
