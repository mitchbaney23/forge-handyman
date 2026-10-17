"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createCustomerAction } from "@/app/admin/customers/actions";
import type { CreateCustomerActionResult } from "@/app/admin/customers/form-types";
import {
  EMPTY_JOB_FIELDS,
  Field,
  inputClass,
  JobFields,
  type JobFieldsValue,
} from "@/components/admin/JobFields";

// Manual "Add customer" panel: name/phone/email/notes plus an optional
// "also start a deal" section. Submits to createCustomerAction, which routes
// through the shared createCustomer core (lib/crm/mutations.ts).
export function AddCustomerForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CreateCustomerActionResult | null>(null);

  // Controlled fields (a small form — plain useState is clearer than FormData).
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const [withDeal, setWithDeal] = useState(false);
  const [deal, setDeal] = useState<JobFieldsValue>(EMPTY_JOB_FIELDS);

  function reset() {
    setName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setWithDeal(false);
    setDeal(EMPTY_JOB_FIELDS);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await createCustomerAction({
        name,
        phone: phone || undefined,
        email: email || undefined,
        notes: notes || undefined,
        deal: withDeal
          ? {
              serviceType: deal.serviceType,
              address: deal.address || undefined,
              description: deal.description || undefined,
              preferredDate: deal.preferredDate || undefined,
              urgency: deal.urgency || undefined,
            }
          : undefined,
      });
      setResult(res);
      if (res.ok) {
        reset();
        // Refresh the server-rendered table (and pipeline) to show the new row.
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary text-sm"
      >
        + Add customer
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-navy/10 bg-white p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          New customer
        </h2>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setResult(null);
          }}
          className="text-xs font-medium text-ink/55 hover:text-navy"
        >
          Close
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Jane Doe"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              placeholder="(919) 555-0142"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="jane@example.com"
            />
          </Field>
          <Field label="Notes">
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className={inputClass}
              placeholder="Met at the Garner market"
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink/80">
          <input
            type="checkbox"
            checked={withDeal}
            onChange={(e) => setWithDeal(e.target.checked)}
            className="h-4 w-4 rounded border-navy/30 text-amber-forge focus:ring-amber-forge/40"
          />
          Also start a deal in the pipeline (status “New”)
        </label>

        {withDeal && (
          <div className="rounded-lg border border-navy/10 bg-cream/30 p-4">
            <JobFields value={deal} onChange={setDeal} required idPrefix="add-customer" />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary text-sm">
            {pending ? "Saving…" : withDeal ? "Add customer + deal" : "Add customer"}
          </button>
          {result && !result.ok && (
            <span className="text-sm text-red-700">
              {result.error}
              {result.duplicateId && (
                <>
                  {" "}
                  <Link
                    href={`/admin/customers/${encodeURIComponent(result.duplicateId)}`}
                    className="font-medium underline hover:text-navy"
                  >
                    Open them
                  </Link>
                </>
              )}
            </span>
          )}
          {result && result.ok && (
            <span className="text-sm text-emerald-700">{result.message}</span>
          )}
        </div>
      </form>
    </div>
  );
}
