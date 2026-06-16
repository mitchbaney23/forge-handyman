"use client";

import { useState, useTransition } from "react";
import { statusOptionsFor } from "@/lib/jobs/status-machine";
import {
  dispatchToDavid,
  markComplete,
  recordFirstTouch,
  updateJobStatus,
  type ActionResult,
} from "./actions";

export function JobActions({
  jobId,
  currentStatus,
  balanceOwedCents,
  firstTouchSentAt,
}: {
  jobId: string;
  currentStatus: string;
  balanceOwedCents: number;
  firstTouchSentAt: string;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionResult | null>(null);
  const [confirmingComplete, setConfirmingComplete] = useState(false);

  const handleStatusChange = (newStatus: string) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await updateJobStatus(jobId, newStatus);
      setFeedback(res);
    });
  };

  const handleMarkComplete = () => {
    setFeedback(null);
    setConfirmingComplete(false);
    startTransition(async () => {
      const res = await markComplete(jobId);
      setFeedback(res);
    });
  };

  const handleRecordFirstTouch = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await recordFirstTouch(jobId);
      setFeedback(res);
    });
  };

  const handleDispatch = () => {
    setFeedback(null);
    startTransition(async () => {
      const res = await dispatchToDavid(jobId);
      setFeedback(res);
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor="status"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
        >
          Status
        </label>
        <select
          id="status"
          disabled={pending}
          value={currentStatus || ""}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="block w-full max-w-xs rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
        >
          {statusOptionsFor(currentStatus).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {!firstTouchSentAt && (
          <button
            type="button"
            disabled={pending}
            onClick={handleRecordFirstTouch}
            className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy hover:border-navy hover:bg-navy hover:text-white disabled:opacity-50"
          >
            Record first touch
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={handleDispatch}
          className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy hover:border-navy hover:bg-navy hover:text-white disabled:opacity-50"
        >
          Re-dispatch to David
        </button>
        {currentStatus !== "Complete" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmingComplete(true)}
            className="btn-primary"
          >
            Mark Complete
            {balanceOwedCents > 0 && (
              <span className="ml-1 text-xs opacity-90">
                · charge ${(balanceOwedCents / 100).toFixed(2)}
              </span>
            )}
          </button>
        )}
      </div>

      {confirmingComplete && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <div className="font-medium text-amber-900">
            Mark this job complete?
          </div>
          {balanceOwedCents > 0 && (
            <div className="mt-1 text-xs text-amber-900/80">
              This will also charge the saved card for{" "}
              <strong>${(balanceOwedCents / 100).toFixed(2)}</strong>. This
              cannot be undone except via a refund.
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={pending}
              className="rounded-md bg-amber-forge px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-forge-dark"
            >
              Yes, mark complete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingComplete(false)}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            feedback.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {feedback.ok ? feedback.message : feedback.error}
        </div>
      )}
    </div>
  );
}
