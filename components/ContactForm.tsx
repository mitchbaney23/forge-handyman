"use client";

import { useState, type FormEvent } from "react";
import { REFERRAL_SOURCES, SERVICE_OPTIONS } from "@/lib/constants";
import { Icon } from "@/lib/icons";

type Status = "idle" | "submitting" | "success" | "error" | "out-of-area";

type OutOfAreaInfo = { distanceMiles: number; radiusMiles: number };

type FieldErrors = Partial<Record<keyof FormState, string>>;

type FormState = {
  name: string;
  phone: string;
  email: string;
  address: string;
  serviceType: string;
  preferredDate: string;
  description: string;
  referralSource: string;
};

const initial: FormState = {
  name: "",
  phone: "",
  email: "",
  address: "",
  serviceType: "",
  preferredDate: "",
  description: "",
  referralSource: "",
};

function validate(state: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!state.name.trim()) errors.name = "Please enter your name.";
  if (!state.phone.trim()) errors.phone = "A phone number is required.";
  else if (state.phone.replace(/\D/g, "").length < 10)
    errors.phone = "Please enter a valid phone number.";
  if (!state.email.trim()) errors.email = "An email address is required.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email))
    errors.email = "Please enter a valid email address.";
  if (!state.address.trim())
    errors.address = "Please share your address or city.";
  if (!state.serviceType) errors.serviceType = "Select a service.";
  if (!state.preferredDate)
    errors.preferredDate = "Pick a preferred date.";
  if (!state.description.trim())
    errors.description = "Tell us a bit about the work.";
  return errors;
}

export function ContactForm() {
  const [state, setState] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [serverMessage, setServerMessage] = useState<string>("");
  const [outOfArea, setOutOfArea] = useState<OutOfAreaInfo | null>(null);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate(state);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setStatus("submitting");
    setServerMessage("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("error");
        setServerMessage(
          data?.error ||
            "We couldn't submit your request. Please try again or call us directly.",
        );
        return;
      }
      if (data?.outOfArea) {
        setStatus("out-of-area");
        setOutOfArea({
          distanceMiles: data.distanceMiles,
          radiusMiles: data.radiusMiles,
        });
        return;
      }
      setStatus("success");
      setState(initial);
    } catch {
      setStatus("error");
      setServerMessage(
        "Network error — please try again or call (828) 551-9690.",
      );
    }
  };

  if (status === "out-of-area" && outOfArea) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-forge text-white">
          <Icon name="map-pin" className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-xl font-semibold text-navy">
          You&rsquo;re just outside our service area
        </h3>
        <p className="mt-2 text-sm text-ink/80">
          Your address looks to be about{" "}
          <span className="font-semibold">
            {outOfArea.distanceMiles} miles
          </span>{" "}
          from Garner, and we currently keep bookings within roughly{" "}
          {outOfArea.radiusMiles} miles so we can stay local and responsive.
        </p>
        <p className="mt-3 text-sm text-ink/80">
          That said — we occasionally make exceptions for bigger jobs. Give David
          a call at{" "}
          <a
            href="tel:+18285519690"
            className="font-semibold text-amber-forge underline hover:text-navy"
          >
            (828) 551-9690
          </a>{" "}
          and we&rsquo;ll see what we can do.
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setOutOfArea(null);
          }}
          className="mt-5 text-sm font-semibold text-navy hover:text-amber-forge"
        >
          Update my address
        </button>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white">
          <Icon name="check" className="h-6 w-6" />
        </div>
        <h3 className="mt-4 text-xl font-semibold text-emerald-900">
          Request received — thank you!
        </h3>
        <p className="mt-2 text-sm text-emerald-800">
          David will review your details and get back to you shortly with a free
          estimate. For urgent requests, call us at{" "}
          <a href="tel:+18285519690" className="font-semibold underline">
            (828) 551-9690
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-5 text-sm font-semibold text-emerald-700 hover:text-emerald-900"
        >
          Submit another request
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-5 rounded-xl border border-navy/10 bg-white p-6 shadow-card sm:p-8"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="name"
          label="Name"
          required
          error={errors.name}
        >
          <input
            id="name"
            name="name"
            autoComplete="name"
            value={state.name}
            onChange={(e) => update("name", e.target.value)}
            className={inputClass(!!errors.name)}
          />
        </Field>
        <Field id="phone" label="Phone" required error={errors.phone}>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="(555) 555-5555"
            value={state.phone}
            onChange={(e) => update("phone", e.target.value)}
            className={inputClass(!!errors.phone)}
          />
        </Field>
      </div>

      <Field id="email" label="Email" required error={errors.email}>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={state.email}
          onChange={(e) => update("email", e.target.value)}
          className={inputClass(!!errors.email)}
        />
      </Field>

      <Field
        id="address"
        label="Address or City"
        required
        error={errors.address}
      >
        <input
          id="address"
          name="address"
          autoComplete="street-address"
          placeholder="123 Main St, Garner, NC"
          value={state.address}
          onChange={(e) => update("address", e.target.value)}
          className={inputClass(!!errors.address)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="serviceType"
          label="Service Needed"
          required
          error={errors.serviceType}
        >
          <select
            id="serviceType"
            name="serviceType"
            value={state.serviceType}
            onChange={(e) => update("serviceType", e.target.value)}
            className={inputClass(!!errors.serviceType)}
          >
            <option value="" disabled>
              Select a service…
            </option>
            {SERVICE_OPTIONS.map((service) => (
              <option key={service} value={service}>
                {service}
              </option>
            ))}
          </select>
        </Field>
        <Field
          id="preferredDate"
          label="Preferred Date"
          required
          error={errors.preferredDate}
        >
          <input
            id="preferredDate"
            name="preferredDate"
            type="date"
            value={state.preferredDate}
            min={new Date().toISOString().split("T")[0]}
            onChange={(e) => update("preferredDate", e.target.value)}
            className={inputClass(!!errors.preferredDate)}
          />
        </Field>
      </div>

      <Field
        id="description"
        label="Description of Work"
        required
        error={errors.description}
      >
        <textarea
          id="description"
          name="description"
          rows={5}
          placeholder="Tell us what needs doing. Be as specific as you like — the more detail, the better the estimate."
          value={state.description}
          onChange={(e) => update("description", e.target.value)}
          className={inputClass(!!errors.description)}
        />
      </Field>

      <Field id="referralSource" label="How did you hear about us?">
        <select
          id="referralSource"
          name="referralSource"
          value={state.referralSource}
          onChange={(e) => update("referralSource", e.target.value)}
          className={inputClass(false)}
        >
          <option value="">Prefer not to say</option>
          {REFERRAL_SOURCES.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </Field>

      {status === "error" && serverMessage && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {serverMessage}
        </div>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="btn-primary w-full text-base"
      >
        {status === "submitting" ? "Sending…" : "Request a Free Estimate"}
        {status !== "submitting" && <Icon name="arrow-right" className="h-4 w-4" />}
      </button>
      <p className="text-center text-xs text-ink/55">
        We&rsquo;ll respond within one business day. No spam, ever.
      </p>
    </form>
  );
}

function inputClass(hasError: boolean) {
  return [
    "block w-full rounded-lg border bg-white px-3.5 py-2.5 text-sm text-ink",
    "placeholder:text-ink/40",
    "focus:outline-none focus:ring-2 focus:ring-offset-1",
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-red-200"
      : "border-navy/15 focus:border-navy focus:ring-amber-forge/40",
  ].join(" ");
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1.5 flex items-center gap-1 text-sm font-semibold text-navy"
      >
        {label}
        {required && <span className="text-amber-forge">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
