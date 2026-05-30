"use client";

import { useState, useTransition } from "react";
import { anonymizeCustomer, type DataRequestResult } from "./actions";

export function DataRequestForm() {
  const [email, setEmail] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<DataRequestResult | null>(null);

  const run = () => {
    setResult(null);
    setConfirming(false);
    startTransition(async () => {
      const res = await anonymizeCustomer(email);
      setResult(res);
      if (res.ok) setEmail("");
    });
  };

  return (
    <div className="rounded-xl border border-navy/10 bg-white p-6 shadow-card">
      <h2 className="text-lg font-semibold text-navy">
        Anonymize a customer&rsquo;s data
      </h2>
      <p className="mt-2 text-sm text-ink/70">
        Enter a customer email to honor a deletion request. Every matching row
        has its personal info (name, phone, email, address, description, photos)
        replaced with <code className="rounded bg-navy/5 px-1 text-xs">[REDACTED]</code>.
        The row itself is kept &mdash; anonymized, not deleted &mdash; so job
        and payment records stay intact for tax compliance.
      </p>

      <div className="mt-4">
        <label
          htmlFor="customer-email"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60"
        >
          Customer email
        </label>
        <input
          id="customer-email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setConfirming(false);
            setResult(null);
          }}
          placeholder="customer@example.com"
          disabled={pending}
          className="block w-full max-w-md rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
        />
      </div>

      {!confirming && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending || !email.trim()}
          className="btn-primary mt-4 disabled:opacity-50"
        >
          Anonymize this customer
        </button>
      )}

      {confirming && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Permanently redact all PII for{" "}
            <span className="font-mono">{email.trim().toLowerCase()}</span>?
          </p>
          <p className="mt-1 text-xs text-amber-900/80">
            This cannot be undone. The customer&rsquo;s name, contact info,
            address, description, and photo links will be wiped from every
            matching row.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={run}
              disabled={pending}
              className="rounded-md bg-amber-forge px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-forge-dark disabled:opacity-50"
            >
              {pending ? "Anonymizing…" : "Yes, anonymize"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div
          className={`mt-4 rounded-lg border p-3 text-sm ${
            result.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {result.ok ? result.message : result.error}
        </div>
      )}
    </div>
  );
}
