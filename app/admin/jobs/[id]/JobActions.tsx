"use client";

import { useState, useTransition } from "react";
import { statusOptionsFor } from "@/lib/jobs/status-machine";
import type { ActionResult } from "@/lib/admin/guard";
import {
  adjustBalance,
  collectBalance,
  dispatchToDavid,
  markComplete,
  recordFirstTouch,
  sendBalanceLink,
  updateJobStatus,
} from "./actions";

export function JobActions({
  jobId,
  currentStatus,
  balanceOwedCents,
  hasSavedCard,
  firstTouchSentAt,
}: {
  jobId: string;
  currentStatus: string;
  balanceOwedCents: number;
  hasSavedCard: boolean;
  firstTouchSentAt: string;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionResult | null>(null);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [confirmingCollect, setConfirmingCollect] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [newBalance, setNewBalance] = useState((balanceOwedCents / 100).toFixed(2));
  const [adjustReason, setAdjustReason] = useState("");

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

  const handleCollectBalance = () => {
    setFeedback(null);
    setConfirmingCollect(false);
    startTransition(async () => {
      const res = await collectBalance(jobId);
      setFeedback(res);
    });
  };

  const openAdjust = () => {
    setFeedback(null);
    setConfirmingComplete(false);
    setConfirmingCollect(false);
    setNewBalance((balanceOwedCents / 100).toFixed(2));
    setAdjustReason("");
    setAdjusting(true);
  };

  const handleAdjustBalance = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFeedback(null);
    const amount = parseFloat(newBalance);
    startTransition(async () => {
      const res = await adjustBalance(jobId, amount, adjustReason);
      setFeedback(res);
      if (res.ok) setAdjusting(false);
    });
  };

  const handleSendBalanceLink = () => {
    setFeedback(null);
    setConfirmingCollect(false);
    startTransition(async () => {
      const res = await sendBalanceLink(jobId);
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
            {balanceOwedCents > 0 && hasSavedCard && (
              <span className="ml-1 text-xs opacity-90">
                · charge ${(balanceOwedCents / 100).toFixed(2)}
              </span>
            )}
          </button>
        )}
        {currentStatus === "Complete" && balanceOwedCents > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmingCollect(true)}
            className="btn-primary"
          >
            {hasSavedCard
              ? `Collect balance · charge $${(balanceOwedCents / 100).toFixed(2)}`
              : `Email payment link for $${(balanceOwedCents / 100).toFixed(2)}`}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={openAdjust}
          className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy hover:border-navy hover:bg-navy hover:text-white disabled:opacity-50"
        >
          Adjust balance
        </button>
      </div>

      {adjusting && (
        <form
          onSubmit={handleAdjustBalance}
          className="rounded-lg border border-navy/15 bg-navy/[0.03] p-4 text-sm"
        >
          <div className="font-medium text-navy">Change the balance owed</div>
          <p className="mt-1 text-xs text-ink/65">
            Currently <strong>${(balanceOwedCents / 100).toFixed(2)}</strong>.
            This is what Mark Complete charges the saved card (or what the
            payment link asks for). Nothing is charged or refunded now; the
            change and your reason go on the timeline. If a payment link was
            already emailed, it is cancelled so the old amount can&rsquo;t be
            paid.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div>
              <label
                htmlFor="new-balance"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
              >
                New balance (USD)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
                  $
                </span>
                <input
                  id="new-balance"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={newBalance}
                  onChange={(e) => setNewBalance(e.target.value)}
                  className="block w-full rounded-lg border border-navy/15 bg-white py-2 pl-7 pr-3 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="adjust-reason"
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
              >
                Why
              </label>
              <input
                id="adjust-reason"
                type="text"
                required
                minLength={3}
                maxLength={500}
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Job took less time than quoted"
                className="block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              disabled={pending || !newBalance || adjustReason.trim().length < 3}
              className="rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save balance"}
            </button>
            <button
              type="button"
              onClick={() => setAdjusting(false)}
              className="rounded-md border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy hover:bg-navy/5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {confirmingComplete && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <div className="font-medium text-amber-900">
            Mark this job complete?
          </div>
          {balanceOwedCents > 0 && hasSavedCard && (
            <div className="mt-1 text-xs text-amber-900/80">
              This will also charge the saved card for{" "}
              <strong>${(balanceOwedCents / 100).toFixed(2)}</strong>. This
              cannot be undone except via a refund.
            </div>
          )}
          {balanceOwedCents > 0 && !hasSavedCard && (
            <div className="mt-1 text-xs text-amber-900/80">
              <strong>No saved card on this job</strong> — completing will NOT
              charge the ${(balanceOwedCents / 100).toFixed(2)} balance. After
              completing, use &ldquo;Email payment link&rdquo; to collect it.
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

      {confirmingCollect && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
          <div className="font-medium text-amber-900">
            {hasSavedCard
              ? `Charge the saved card $${(balanceOwedCents / 100).toFixed(2)}?`
              : `Email the customer a payment link for $${(balanceOwedCents / 100).toFixed(2)}?`}
          </div>
          <div className="mt-1 text-xs text-amber-900/80">
            {hasSavedCard
              ? "This charges the card from the deposit checkout. It cannot be undone except via a refund. If this balance was already collected outside the app (e.g. Stripe Dashboard), cancel and zero it there instead."
              : "The customer pays on a secure Stripe page; the balance clears and a paid-in-full receipt sends automatically once they do. If this balance was already collected outside the app, don't send the link."}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={hasSavedCard ? handleCollectBalance : handleSendBalanceLink}
              disabled={pending}
              className="rounded-md bg-amber-forge px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-forge-dark"
            >
              {hasSavedCard ? "Yes, charge the card" : "Yes, email the link"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingCollect(false)}
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
