"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SERVICE_CATEGORIES, URGENCY_OPTIONS } from "@/lib/constants";
import { createCustomerAction } from "@/app/admin/customers/actions";
import type { CreateCustomerActionResult } from "@/app/admin/customers/form-types";

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
  const [serviceType, setServiceType] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [urgency, setUrgency] = useState("");

  function reset() {
    setName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setWithDeal(false);
    setServiceType("");
    setAddress("");
    setDescription("");
    setPreferredDate("");
    setUrgency("");
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
              serviceType,
              address: address || undefined,
              description: description || undefined,
              preferredDate: preferredDate || undefined,
              urgency: urgency || undefined,
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
          <div className="space-y-4 rounded-lg border border-navy/10 bg-cream/30 p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Service" required>
                <select
                  required={withDeal}
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Select a service…</option>
                  {SERVICE_CATEGORIES.map((s) => (
                    <option key={s.code} value={s.label}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Urgency">
                <select
                  value={urgency}
                  onChange={(e) => setUrgency(e.target.value)}
                  className={inputClass}
                >
                  <option value="">—</option>
                  {URGENCY_OPTIONS.map((u) => (
                    <option key={u.code} value={u.code}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Address">
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className={inputClass}
                  placeholder="123 Oak St, Garner NC"
                />
              </Field>
              <Field label="Preferred date">
                <input
                  type="date"
                  value={preferredDate}
                  onChange={(e) => setPreferredDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className={inputClass}
                placeholder="What needs doing?"
              />
            </Field>
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

const inputClass =
  "block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40";

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60">
        {label}
        {required && <span className="ml-0.5 text-amber-forge">*</span>}
      </span>
      {children}
    </label>
  );
}
