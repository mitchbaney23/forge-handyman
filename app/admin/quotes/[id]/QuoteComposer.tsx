"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sendQuote, type SendQuoteResult } from "./actions";

const TIER_OPTIONS = [
  { value: "small" as const, label: "Small — half-day or less" },
  { value: "medium" as const, label: "Medium — full day" },
  { value: "large" as const, label: "Large — multi-day" },
];

export function QuoteComposer({
  jobId,
  customerName,
  customerEmail,
  serviceType,
  initialDescription,
  prefillDepositDollars,
}: {
  jobId: string;
  customerName: string;
  customerEmail: string;
  serviceType: string;
  initialDescription: string;
  // For self-scheduled jobs: the price the customer already selected, pre-filled
  // as the deposit so the quote is a review-and-send. Undefined for custom jobs.
  prefillDepositDollars?: number;
}) {
  const [deposit, setDeposit] = useState(
    prefillDepositDollars ? String(prefillDepositDollars) : "",
  );
  const [balance, setBalance] = useState(prefillDepositDollars ? "0" : "");
  const [tier, setTier] = useState<"small" | "medium" | "large">("medium");
  const [description, setDescription] = useState(initialDescription);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SendQuoteResult | null>(null);

  const depositNum = parseFloat(deposit) || 0;
  const balanceNum = parseFloat(balance) || 0;
  const total = depositNum + balanceNum;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await sendQuote({
        jobId,
        depositDollars: depositNum,
        balanceDollars: balanceNum,
        tier,
        descriptionOverride: description,
      });
      setResult(res);
    });
  };

  if (result?.ok) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">Quote sent ✓</h2>
        <p className="mt-2 text-sm text-emerald-900/85">
          Email is on its way to {customerEmail}. The payment link expires on{" "}
          {new Date(result.expiresAt).toLocaleDateString()}.
        </p>
        <div className="mt-4 rounded-lg bg-white/60 p-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-900/70">
            Payment Link (for your records)
          </div>
          <a
            href={result.paymentLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sm font-mono text-emerald-800 underline hover:no-underline"
          >
            {result.paymentLinkUrl}
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/admin/jobs/${jobId}`} className="btn-primary">
            Back to job
          </Link>
          <Link
            href="/admin"
            className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
          >
            Back to overview
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-xl border border-navy/10 bg-white p-6 shadow-card"
    >
      <div>
        <h2 className="text-lg font-semibold text-navy">Compose quote</h2>
        <p className="mt-1 text-sm text-ink/60">
          Sending to <span className="font-medium text-ink">{customerName}</span>{" "}
          at <span className="font-medium text-ink">{customerEmail}</span> for{" "}
          <span className="font-medium text-ink">{serviceType}</span>.
        </p>
        {prefillDepositDollars ? (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Pre-filled with the ${prefillDepositDollars} they selected at booking
            — review and adjust the deposit/balance split if you like.
          </p>
        ) : null}
      </div>

      <div>
        <label
          htmlFor="tier"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
        >
          Job tier
        </label>
        <select
          id="tier"
          value={tier}
          onChange={(e) => setTier(e.target.value as "small" | "medium" | "large")}
          className="block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
        >
          {TIER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="deposit"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
          >
            Deposit (USD)
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
              $
            </span>
            <input
              id="deposit"
              type="number"
              step="0.01"
              min="1"
              required
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
              className="block w-full rounded-lg border border-navy/15 bg-white pl-7 pr-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
              placeholder="150.00"
            />
          </div>
          <p className="mt-1 text-xs text-ink/55">
            Charged now to book the date and save card on file.
          </p>
        </div>
        <div>
          <label
            htmlFor="balance"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
          >
            Balance (USD)
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
              $
            </span>
            <input
              id="balance"
              type="number"
              step="0.01"
              min="0"
              required
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              className="block w-full rounded-lg border border-navy/15 bg-white pl-7 pr-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
              placeholder="350.00"
            />
          </div>
          <p className="mt-1 text-xs text-ink/55">
            Auto-charged when you Mark Complete.
          </p>
        </div>
      </div>

      {total > 0 && (
        <div className="rounded-lg border border-navy/10 bg-navy/5 px-4 py-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-ink/70">Total estimate</span>
            <span className="text-lg font-semibold text-navy">
              ${total.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      <div>
        <label
          htmlFor="description"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
        >
          Description (shown to customer in the email)
        </label>
        <textarea
          id="description"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          className="block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
        />
        <p className="mt-1 text-xs text-ink/55">
          {description.length}/500 characters
        </p>
      </div>

      {result && !result.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {result.error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending || !deposit || !balance}
          className="btn-primary"
        >
          {pending ? "Sending…" : "Create & Send Quote"}
        </button>
        <Link
          href={`/admin/jobs/${jobId}`}
          className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy hover:border-navy hover:bg-navy hover:text-white"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
