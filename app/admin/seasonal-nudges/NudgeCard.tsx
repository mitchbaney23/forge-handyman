"use client";

import { useState, useTransition } from "react";
import {
  sendSeasonalNudge,
  skipSeasonalNudge,
  type NudgeActionResult,
} from "./actions";
import type { NudgeCandidate } from "@/lib/automation/nudges";

export function NudgeCard({
  candidate,
  daysSinceLastJob,
}: {
  candidate: Omit<NudgeCandidate, "template"> & {
    template: { subject: string; body: string };
  };
  daysSinceLastJob: number;
}) {
  const [pending, startTransition] = useTransition();
  const [subject, setSubject] = useState(candidate.template.subject);
  const [body, setBody] = useState(candidate.template.body);
  const [feedback, setFeedback] = useState<NudgeActionResult | null>(null);

  const handleSend = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await sendSeasonalNudge({
        recipientEmail: candidate.email,
        recipientName: candidate.name,
        subject,
        body,
        jobIds: candidate.jobIds,
      });
      setFeedback(res);
    });
  };

  const handleSkip = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await skipSeasonalNudge({
        recipientEmail: candidate.email,
        jobIds: candidate.jobIds,
      });
      setFeedback(res);
    });
  };

  if (feedback?.ok) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
        <div className="font-semibold">{candidate.name || candidate.email}</div>
        <div className="mt-1 text-emerald-900/85">{feedback.message}</div>
      </div>
    );
  }

  return (
    <article className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-navy">
            {candidate.name || "(no name)"}
          </div>
          <div className="text-xs text-ink/60">
            {candidate.email} · {candidate.priorJobCount} prior job
            {candidate.priorJobCount === 1 ? "" : "s"} · last {daysSinceLastJob} days ago
          </div>
        </div>
      </header>
      <div className="space-y-3">
        <div>
          <label
            htmlFor={`subject-${candidate.email}`}
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
          >
            Subject
          </label>
          <input
            id={`subject-${candidate.email}`}
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={pending}
            className="block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
          />
        </div>
        <div>
          <label
            htmlFor={`body-${candidate.email}`}
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
          >
            Body
          </label>
          <textarea
            id={`body-${candidate.email}`}
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={pending}
            className="block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm font-mono leading-relaxed focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
          />
          <p className="mt-1 text-xs text-ink/50">
            An unsubscribe footer is appended automatically. Edit anything
            above before sending.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={pending}
          className="btn-primary"
        >
          {pending ? "Sending…" : "Send nudge"}
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={pending}
          className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy hover:border-navy hover:bg-navy hover:text-white disabled:opacity-50"
        >
          Skip for 180 days
        </button>
      </div>
      {feedback && !feedback.ok && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {feedback.error}
        </div>
      )}
    </article>
  );
}
