"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/guard";
import { requestReviewAction } from "./actions";

// "Google review" on the job page: when the customer was last asked, and a
// button to ask (again) now, with a one-step confirm since it emails them.
export function ReviewRequestPanel({
  jobId,
  customerName,
  customerEmail,
  reviewSentAt,
  sendCount,
  optedOut,
}: {
  jobId: string;
  customerName: string;
  customerEmail: string;
  reviewSentAt: string;
  sendCount: number;
  optedOut: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const asked = reviewSentAt
    ? `Asked ${new Date(reviewSentAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}${sendCount > 1 ? ` (${sendCount} times)` : ""}.`
    : "Not asked yet. Closing the job out sends the request with their receipt.";

  const send = () => {
    setResult(null);
    startTransition(async () => {
      const res = await requestReviewAction(jobId);
      setResult(res);
      if (res.ok) {
        setConfirming(false);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-ink/70">{asked}</p>
      {optedOut ? (
        <p className="text-xs text-ink/55">They unsubscribed from these emails.</p>
      ) : !customerEmail ? (
        <p className="text-xs text-ink/55">No email on file.</p>
      ) : !confirming ? (
        <button
          type="button"
          onClick={() => {
            setConfirming(true);
            setResult(null);
          }}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy hover:text-white"
        >
          {reviewSentAt ? "Send review request again" : "Send review request"}
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-ink/70">
            Email {customerName || customerEmail} a link to leave a Google review?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={send}
              disabled={pending}
              className="btn-primary text-sm"
            >
              {pending ? "Sending…" : "Yes, send it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-md border border-navy/20 px-3 py-1.5 text-sm text-ink/70 hover:bg-navy/5 disabled:opacity-50"
            >
              Not now
            </button>
          </div>
        </div>
      )}
      {result && (
        <p className={`text-sm ${result.ok ? "text-green-700" : "text-red-700"}`}>
          {result.ok ? result.message : result.error}
        </p>
      )}
    </div>
  );
}
