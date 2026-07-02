"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/admin/guard";
import { refundPayment } from "./actions";

const PURPOSE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  "balance-charge": "Balance",
};

// Full-refund buttons for the job's succeeded payments. The job status flip
// (Refunded / Partial Refund) is webhook-owned — this UI only issues the
// refund and reports what Stripe said.
export function RefundSection({
  jobId,
  payments,
}: {
  jobId: string;
  payments: { id: string; purpose: string; amountCents: number | null }[];
}) {
  const [pending, startTransition] = useTransition();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ActionResult | null>(null);

  const handleRefund = (paymentId: string) => {
    setFeedback(null);
    setConfirmingId(null);
    startTransition(async () => {
      const res = await refundPayment(jobId, paymentId);
      setFeedback(res);
    });
  };

  return (
    <div className="space-y-3">
      {payments.map((p) => {
        const label = PURPOSE_LABEL[p.purpose] ?? p.purpose;
        const dollars =
          p.amountCents !== null ? `$${(p.amountCents / 100).toFixed(2)}` : "—";
        return (
          <div
            key={p.id}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-ink/80">
              {label} · <strong>{dollars}</strong>
            </span>
            {confirmingId === p.id ? (
              <span className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => handleRefund(p.id)}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Yes, refund {dollars}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  className="rounded-md border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy hover:bg-navy/5"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setFeedback(null);
                  setConfirmingId(p.id);
                }}
                className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:border-red-600 hover:bg-red-600 hover:text-white disabled:opacity-50"
              >
                Refund…
              </button>
            )}
          </div>
        );
      })}
      <p className="text-xs text-ink/55">
        Full refund to the original card. The job status flips to Refunded once
        Stripe confirms (usually seconds).
      </p>
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
