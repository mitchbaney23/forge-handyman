"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { Field, inputClass } from "@/components/admin/JobFields";
import type {
  UpdateContactActionResult,
  UpdateContactInput,
} from "@/app/admin/customers/form-types";

// The server action this form invokes, bound to one customer by the profile
// page (same pattern as EditNotesForm's SaveNotesAction).
export type SaveContactAction = (
  input: UpdateContactInput,
) => Promise<UpdateContactActionResult>;

// The customer's phone + email with an Edit button that swaps in a small form
// for name / phone / email. Saving also updates the copies on their jobs (the
// server core does that), so the next quote goes to the corrected address.
export function ContactDetails({
  name,
  phone,
  email,
  editable,
  action,
}: {
  name: string;
  phone: string;
  email: string;
  // False for an anonymized customer: nothing to edit.
  editable: boolean;
  action: SaveContactAction;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<UpdateContactInput>({ name, phone, email });
  const [result, setResult] = useState<UpdateContactActionResult | null>(null);

  const startEditing = () => {
    setForm({ name, phone, email });
    setResult(null);
    setEditing(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await action(form);
      setResult(res);
      if (res.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  };

  if (!editing) {
    return (
      <div className="mt-3 space-y-2">
        <dl className="space-y-1.5 text-sm text-ink/75">
          {phone && (
            <ContactRow icon="phone" label="Phone">
              <a href={`tel:${phone}`} className="hover:underline">
                {phone}
              </a>
            </ContactRow>
          )}
          {email && (
            <ContactRow icon="mail" label="Email">
              <a href={`mailto:${email}`} className="hover:underline">
                {email}
              </a>
            </ContactRow>
          )}
          {!phone && !email && (
            <span className="text-ink/50">No contact details on file.</span>
          )}
        </dl>
        <div className="flex flex-wrap items-center gap-3">
          {editable && (
            <button
              type="button"
              onClick={startEditing}
              className="rounded-lg border border-navy/15 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:border-navy hover:bg-navy hover:text-white"
            >
              Edit contact
            </button>
          )}
          {result?.ok && <span className="text-xs text-emerald-700">{result.message}</span>}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required>
          <input
            type="text"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputClass}
            autoComplete="off"
          />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className={inputClass}
            placeholder="(919) 555-0142"
            autoComplete="off"
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className={inputClass}
            placeholder="jane@example.com"
            autoComplete="off"
          />
        </Field>
      </div>
      <p className="text-xs text-ink/55">
        Saving also updates these on the customer&rsquo;s jobs, so quotes and
        reminders go to the new details.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary text-sm">
          {pending ? "Saving…" : "Save contact"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setResult(null);
          }}
          disabled={pending}
          className="text-sm font-medium text-ink/60 hover:text-navy"
        >
          Cancel
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
      </div>
    </form>
  );
}

function ContactRow({
  icon,
  label,
  children,
}: {
  icon: "phone" | "mail";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon name={icon} className="h-4 w-4 text-ink/45" aria-hidden="true" />
      <span className="sr-only">{label}:</span>
      <span className="text-navy">{children}</span>
    </div>
  );
}
