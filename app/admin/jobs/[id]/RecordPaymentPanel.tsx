"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/admin/guard";
import {
  METHOD_DETAIL_MAX,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  PAYMENT_NOTE_MAX,
  isDepositPayment,
  suggestBalanceAfter,
  type PaymentMethod,
} from "@/lib/payment-methods";
import { recordPaymentAction } from "./actions";

const inputClass =
  "block w-full rounded-md border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60";

const DETAIL_PROMPT: Partial<Record<PaymentMethod, { label: string; placeholder: string }>> = {
  check: { label: "Check number (optional)", placeholder: "1043" },
  venmo: { label: "Venmo name or note (optional)", placeholder: "@jane-doe" },
  zelle: { label: "Zelle reference (optional)", placeholder: "Confirmation #" },
  other: { label: "How did they pay?", placeholder: "Cash App, gift card…" },
};

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// "Record a payment" on the job page: money taken outside Stripe. Suggests the
// balance left (editable), offers to close the job out when nothing is left,
// and emails the customer a receipt unless unticked.
export function RecordPaymentPanel({
  jobId,
  status,
  depositPaidCents,
  balanceOwedCents,
  lastQuoteTotalCents,
  customerEmail,
}: {
  jobId: string;
  status: string;
  depositPaidCents: number;
  balanceOwedCents: number;
  lastQuoteTotalCents: number | null;
  customerEmail: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [detail, setDetail] = useState("");
  const [note, setNote] = useState("");
  const [balanceInput, setBalanceInput] = useState<string | null>(null);
  const [closeOutChoice, setCloseOutChoice] = useState<boolean | null>(null);
  const [emailCustomer, setEmailCustomer] = useState(Boolean(customerEmail));

  const job = { status, depositPaidCents, balanceOwedCents, lastQuoteTotalCents };
  const deposit = isDepositPayment(job);
  const amountCents = Math.round((parseFloat(amount) || 0) * 100);
  const suggestedCents = suggestBalanceAfter({ ...job, amountCents });
  const balanceAfterCents =
    balanceInput === null ? suggestedCents : Math.round((parseFloat(balanceInput) || 0) * 100);
  const canCloseOut = balanceAfterCents === 0 && status !== "Complete";
  // Paid off after the work started: closing out is the likely next step.
  const closeOut =
    canCloseOut && (closeOutChoice ?? (status === "Booked" || status === "In Progress"));

  const detailPrompt = DETAIL_PROMPT[method];
  const canSave =
    amountCents >= 1 && balanceAfterCents >= 0 && (method !== "other" || detail.trim() !== "");

  const reset = () => {
    setAmount("");
    setMethod("cash");
    setDetail("");
    setNote("");
    setBalanceInput(null);
    setCloseOutChoice(null);
    setEmailCustomer(Boolean(customerEmail));
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await recordPaymentAction(jobId, {
        amountDollars: amountCents / 100,
        method,
        methodDetail: detail || undefined,
        note: note || undefined,
        balanceAfterDollars: balanceAfterCents / 100,
        closeOut,
        emailCustomer,
      });
      setResult(res);
      if (res.ok) {
        reset();
        setOpen(false);
        router.refresh();
      }
    });
  };

  if (!open) {
    return (
      <div className="space-y-2">
        {result?.ok && <p className="text-sm text-green-700">{result.message}</p>}
        <p className="text-sm text-ink/70">
          Paid in cash, by check, Venmo, Zelle or another way? Record it here.
        </p>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setResult(null);
          }}
          className="rounded-md border border-navy/20 px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy hover:text-white"
        >
          Record a payment
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="pay-amount" className={labelClass}>
            Amount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
              $
            </span>
            <input
              id="pay-amount"
              type="text"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={`${inputClass} pl-7`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="pay-method" className={labelClass}>
            Paid by
          </label>
          <select
            id="pay-method"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value as PaymentMethod);
              setDetail("");
            }}
            className={inputClass}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {detailPrompt && (
        <div>
          <label htmlFor="pay-detail" className={labelClass}>
            {detailPrompt.label}
          </label>
          <input
            id="pay-detail"
            type="text"
            required={method === "other"}
            maxLength={METHOD_DETAIL_MAX}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder={detailPrompt.placeholder}
            className={inputClass}
          />
        </div>
      )}

      <div>
        <label htmlFor="pay-balance" className={labelClass}>
          Balance left after this
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
            $
          </span>
          <input
            id="pay-balance"
            type="text"
            inputMode="decimal"
            value={balanceInput ?? (suggestedCents / 100).toFixed(2)}
            onChange={(e) => setBalanceInput(e.target.value)}
            className={`${inputClass} pl-7`}
          />
        </div>
        <p className="mt-1 text-xs text-ink/55">
          {deposit
            ? lastQuoteTotalCents != null
              ? `This is their deposit. The quote totals ${money(lastQuoteTotalCents)}.`
              : "This is their deposit; the job moves to Booked."
            : `They owed ${money(balanceOwedCents)} before this.`}{" "}
          Change it if the job total changed.
        </p>
      </div>

      {canCloseOut && (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={closeOut}
            onChange={(e) => setCloseOutChoice(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-navy/30"
          />
          <span>
            Close the job out (mark it Complete). Nothing is charged; their
            receipt asks for a Google review.
          </span>
        </label>
      )}

      {customerEmail ? (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={emailCustomer}
            onChange={(e) => setEmailCustomer(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-navy/30"
          />
          <span>Email {customerEmail} a receipt</span>
        </label>
      ) : (
        <p className="text-xs text-ink/55">No email on file, so no receipt goes out.</p>
      )}

      <div>
        <label htmlFor="pay-note" className={labelClass}>
          Note (optional, for the timeline)
        </label>
        <input
          id="pay-note"
          type="text"
          maxLength={PAYMENT_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Paid at the door after the job"
          className={inputClass}
        />
      </div>

      <p className="text-xs text-ink/55">
        Saving turns off any Stripe payment links already emailed for this job,
        so they can&rsquo;t pay twice. You and operations@ get an email.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || !canSave} className="btn-primary text-sm">
          {pending ? "Saving…" : amountCents > 0 ? `Record ${money(amountCents)}` : "Record payment"}
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
