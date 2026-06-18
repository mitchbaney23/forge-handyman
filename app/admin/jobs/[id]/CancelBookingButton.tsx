"use client";

import { useState, useTransition } from "react";
import { cancelBooking, type ActionResult } from "./actions";

export function CancelBookingButton({ jobId }: { jobId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const run = () => {
    setResult(null);
    startTransition(async () => {
      const res = await cancelBooking(jobId);
      setResult(res);
      if (res.ok) setConfirming(false);
    });
  };

  if (result?.ok) {
    return <p className="text-sm text-green-700">{result.message}</p>;
  }

  return (
    <div className="mt-3">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
        >
          Cancel booking
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-ink/70">
            Cancel this appointment? The time slot reopens and David is notified.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={pending}
              className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-md border border-navy/20 px-3 py-1.5 text-sm text-ink/70 hover:bg-navy/5 disabled:opacity-50"
            >
              Keep it
            </button>
          </div>
        </div>
      )}
      {result && !result.ok && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {result.error}
        </p>
      )}
    </div>
  );
}
