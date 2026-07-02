"use client";

import { useState, useTransition } from "react";
import { sendAllSeasonalNudges, type NudgeActionResult } from "./actions";

export function SendAllButton({ count }: { count: number }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<NudgeActionResult | null>(null);

  const handleSendAll = () => {
    setFeedback(null);
    setConfirming(false);
    startTransition(async () => {
      const res = await sendAllSeasonalNudges();
      setFeedback(res);
    });
  };

  return (
    <div className="space-y-3">
      {confirming ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <div className="font-medium text-amber-900">
            Send all {count} nudges with their default templates?
          </div>
          <div className="mt-1 text-xs text-amber-900/80">
            Edits you made in the cards below are NOT used — batch send uses
            each customer&rsquo;s pre-filled template. Send individually to
            customize.
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={handleSendAll}
              disabled={pending}
              className="rounded-md bg-amber-forge px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-forge-dark disabled:opacity-50"
            >
              Yes, send all {count}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setFeedback(null);
            setConfirming(true);
          }}
          className="btn-primary text-sm disabled:opacity-50"
        >
          {pending ? "Sending…" : `Send all ${count} with default templates`}
        </button>
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
