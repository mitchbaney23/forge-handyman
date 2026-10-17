"use client";

import { SERVICE_CATEGORIES, URGENCY_OPTIONS } from "@/lib/constants";

// The job fields shared by the Add customer form ("also start a deal") and
// the customer page's New job form, so the two can't drift apart.

export interface JobFieldsValue {
  serviceType: string;
  urgency: string;
  address: string;
  preferredDate: string;
  description: string;
}

export const EMPTY_JOB_FIELDS: JobFieldsValue = {
  serviceType: "",
  urgency: "",
  address: "",
  preferredDate: "",
  description: "",
};

export function JobFields({
  value,
  onChange,
  required,
  addressSuggestions = [],
  showPreferredDate = true,
  idPrefix,
}: {
  value: JobFieldsValue;
  onChange: (next: JobFieldsValue) => void;
  required?: boolean;
  // Addresses this customer already has on file, offered as picks.
  addressSuggestions?: string[];
  // Off when the job is being scheduled: the appointment sets the date.
  showPreferredDate?: boolean;
  idPrefix: string;
}) {
  const set = (field: keyof JobFieldsValue) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => onChange({ ...value, [field]: e.target.value });
  const listId = `${idPrefix}-addresses`;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Service" required>
          <select
            required={required}
            value={value.serviceType}
            onChange={set("serviceType")}
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
          <select value={value.urgency} onChange={set("urgency")} className={inputClass}>
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
            value={value.address}
            onChange={set("address")}
            className={inputClass}
            placeholder="123 Oak St, Garner NC"
            list={addressSuggestions.length > 0 ? listId : undefined}
            autoComplete="street-address"
          />
          {addressSuggestions.length > 0 && (
            <datalist id={listId}>
              {addressSuggestions.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          )}
        </Field>
        {showPreferredDate && (
          <Field label="Preferred date">
            <input
              type="date"
              value={value.preferredDate}
              onChange={set("preferredDate")}
              className={inputClass}
            />
          </Field>
        )}
      </div>
      <Field label="Description">
        <textarea
          value={value.description}
          onChange={set("description")}
          rows={2}
          className={inputClass}
          placeholder="What needs doing?"
        />
      </Field>
    </div>
  );
}

export const inputClass =
  "block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40";

export function Field({
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
