"use client";

import Script from "next/script";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CONTACT_METHODS,
  CONTACT_TIMES,
  PROPERTY_TYPES,
  REFERRAL_SOURCES,
  SERVICE_CATEGORIES,
  URGENCY_OPTIONS,
  type ContactMethodCode,
  type ContactTimeCode,
  type PropertyTypeCode,
  type ServiceCategoryCode,
  type UrgencyCode,
} from "@/lib/constants";
import { Icon } from "@/lib/icons";
import { compressIfNeeded } from "@/lib/photo/compress";

const MAX_PHOTOS = 6;

type UploadedPhoto = {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  name: string;
  previewDataUrl: string;
};

type Status = "idle" | "submitting" | "success" | "error" | "out-of-area";

type OutOfAreaInfo = { distanceMiles: number; radiusMiles: number };

type FieldErrors = Partial<Record<keyof FormState, string>>;

type FormState = {
  name: string;
  phone: string;
  email: string;
  address: string;
  propertyType: PropertyTypeCode | "";
  serviceCategories: ServiceCategoryCode[];
  notSure: boolean;
  description: string;
  preferredDate: string;
  urgency: UrgencyCode | "";
  bestContactTime: ContactTimeCode;
  bestContactMethod: ContactMethodCode;
  referralSource: string;
};

const initial: FormState = {
  name: "",
  phone: "",
  email: "",
  address: "",
  propertyType: "",
  serviceCategories: [],
  notSure: false,
  description: "",
  preferredDate: "",
  urgency: "",
  bestContactTime: "any",
  bestContactMethod: "any",
  referralSource: "",
};

interface GooglePlaceResult {
  formatted_address?: string;
  place_id?: string;
  geometry?: { location?: { lat(): number; lng(): number } };
}

interface GoogleAutocomplete {
  addListener: (event: string, callback: () => void) => unknown;
  getPlace: () => GooglePlaceResult;
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback?: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts: {
              componentRestrictions?: { country: string | string[] };
              fields?: string[];
              types?: string[];
              bounds?: unknown;
            },
          ) => GoogleAutocomplete;
        };
        LatLngBounds?: new (
          sw: { lat: number; lng: number },
          ne: { lat: number; lng: number },
        ) => unknown;
        event?: {
          clearInstanceListeners: (instance: unknown) => void;
        };
      };
    };
  }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

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
  if (!state.propertyType) errors.propertyType = "Select a property type.";
  if (!state.notSure && state.serviceCategories.length === 0)
    errors.serviceCategories =
      "Pick at least one service, or check “I'm not sure.”";
  if (!state.preferredDate) errors.preferredDate = "Pick a preferred date.";
  if (!state.urgency) errors.urgency = "Pick how urgent this is.";
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
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const utmSourceRef = useRef<string>("");
  const honeypotRef = useRef<HTMLInputElement>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<GoogleAutocomplete | null>(null);
  // Tentative job_id generated client-side on first photo upload. Reused
  // across all photos for the same submission so they group in one Drive
  // folder. Server validates UUID v4 format on every upload + accepts the
  // same ID on the contact-form submission.
  const jobIdRef = useRef<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);

  function ensureJobId(): string {
    if (jobIdRef.current) return jobIdRef.current;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
    jobIdRef.current = id;
    return id;
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const utm = params.get("utm_source");
    if (utm) utmSourceRef.current = utm.slice(0, 120);
  }, []);

  // Google Places Autocomplete — attaches to the address input when the
  // Maps JS API loads. Biases results to central NC (Forge's service area)
  // but doesn't restrict — customers can still type anything.
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return;
    if (!addressInputRef.current) return;
    if (autocompleteRef.current) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tryAttach = (): boolean => {
      if (cancelled) return true;
      const places = window.google?.maps?.places;
      const Bounds = window.google?.maps?.LatLngBounds;
      const input = addressInputRef.current;
      if (!places || !input) return false;
      // Bias toward Wake/Johnston counties area (Garner-centered).
      const bounds = Bounds
        ? new Bounds({ lat: 35.5, lng: -78.85 }, { lat: 36.0, lng: -78.4 })
        : undefined;
      const ac = new places.Autocomplete(input, {
        componentRestrictions: { country: "us" },
        fields: ["formatted_address", "place_id", "geometry"],
        types: ["address"],
        bounds,
      });
      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        if (place.formatted_address) {
          setState((s) => ({ ...s, address: place.formatted_address! }));
          setErrors((e) => ({ ...e, address: undefined }));
        }
      });
      autocompleteRef.current = ac;
      return true;
    };

    if (!tryAttach()) {
      intervalId = setInterval(() => {
        if (tryAttach() && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }, 250);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      const ac = autocompleteRef.current;
      const ev = window.google?.maps?.event;
      if (ac && ev) ev.clearInstanceListeners(ac);
      autocompleteRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (!turnstileContainerRef.current) return;
    if (turnstileWidgetIdRef.current) return;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tryRender = (): boolean => {
      if (cancelled) return true;
      const ts = window.turnstile;
      const container = turnstileContainerRef.current;
      if (!ts || !container) return false;
      const widgetId = ts.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
      turnstileWidgetIdRef.current = widgetId;
      return true;
    };

    if (!tryRender()) {
      intervalId = setInterval(() => {
        if (tryRender() && intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }, 250);
    }

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
      const ts = window.turnstile;
      const widgetId = turnstileWidgetIdRef.current;
      if (ts && widgetId) {
        try {
          ts.remove(widgetId);
        } catch {
          // ignore — widget may already be gone
        }
      }
      turnstileWidgetIdRef.current = null;
    };
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const toggleCategory = (code: ServiceCategoryCode) => {
    setState((s) => {
      const has = s.serviceCategories.includes(code);
      const next = has
        ? s.serviceCategories.filter((c) => c !== code)
        : [...s.serviceCategories, code];
      // If user picks a category, clear "I'm not sure"
      return {
        ...s,
        serviceCategories: next,
        notSure: next.length > 0 ? false : s.notSure,
      };
    });
    if (errors.serviceCategories)
      setErrors((e) => ({ ...e, serviceCategories: undefined }));
  };

  const toggleNotSure = () => {
    setState((s) => ({
      ...s,
      notSure: !s.notSure,
      // Clear category selections when picking "not sure"
      serviceCategories: !s.notSure ? [] : s.serviceCategories,
    }));
    if (errors.serviceCategories)
      setErrors((e) => ({ ...e, serviceCategories: undefined }));
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPhotoErrors([]);
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      setPhotoErrors([`You can attach up to ${MAX_PHOTOS} photos.`]);
      return;
    }
    const toUpload = Array.from(files).slice(0, remaining);
    const overflow = files.length - toUpload.length;
    setPhotoUploading(true);
    const errors: string[] = [];
    if (overflow > 0) {
      errors.push(
        `Only the first ${toUpload.length} photo${toUpload.length === 1 ? "" : "s"} added (max ${MAX_PHOTOS} total).`,
      );
    }
    const jobId = ensureJobId();

    for (const file of toUpload) {
      try {
        const compressed = await compressIfNeeded(file);
        const previewDataUrl = await readAsDataUrl(compressed);
        const form = new FormData();
        form.set("jobId", jobId);
        form.set("file", compressed);
        const resp = await fetch("/api/upload-photo", {
          method: "POST",
          body: form,
        });
        const data = (await resp.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          photo?: {
            id: string;
            url: string;
            thumbnailUrl: string | null;
            name: string;
          };
        };
        if (!resp.ok || !data.ok || !data.photo) {
          errors.push(
            `${file.name}: ${data.error || "upload failed"}`,
          );
          continue;
        }
        setPhotos((prev) => [
          ...prev,
          { ...data.photo!, previewDataUrl },
        ]);
      } catch (err) {
        errors.push(
          `${file.name}: ${
            err instanceof Error ? err.message : "unexpected error"
          }`,
        );
      }
    }
    setPhotoErrors(errors);
    setPhotoUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (id: string) => {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const resetTurnstile = () => {
    setTurnstileToken("");
    const ts = window.turnstile;
    const widgetId = turnstileWidgetIdRef.current;
    if (ts && widgetId) ts.reset(widgetId);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate(state);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      // Scroll to first error
      const firstErrorKey = Object.keys(nextErrors)[0];
      const el = document.getElementById(firstErrorKey);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      setServerMessage("Please complete the verification challenge below.");
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setServerMessage("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: state.name,
          phone: state.phone,
          email: state.email,
          address: state.address,
          propertyType: state.propertyType,
          serviceCategories: state.serviceCategories,
          notSure: state.notSure,
          description: state.description,
          preferredDate: state.preferredDate,
          urgency: state.urgency,
          bestContactTime: state.bestContactTime,
          bestContactMethod: state.bestContactMethod,
          referralSource: state.referralSource,
          website: honeypotRef.current?.value ?? "",
          turnstileToken: turnstileToken || undefined,
          utmSource: utmSourceRef.current || undefined,
          jobId: jobIdRef.current || undefined,
          photoUrls: photos.map((p) => p.url),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus("error");
        // Maintenance kill switch — friendly, distinct from a generic error.
        if (data?.maintenance) {
          setServerMessage(
            data?.error ||
              "We're updating our booking system right now. Please call us at (555) 123-4567.",
          );
          resetTurnstile();
          return;
        }
        // Surface per-field errors from the server if present so the customer
        // can see exactly which input is being rejected.
        if (
          data?.fieldErrors &&
          typeof data.fieldErrors === "object" &&
          !Array.isArray(data.fieldErrors)
        ) {
          const incoming = data.fieldErrors as Record<string, string>;
          const mapped: FieldErrors = {};
          for (const [key, message] of Object.entries(incoming)) {
            if (typeof message !== "string") continue;
            // Top-level field names (e.g., "phone") map 1:1 to FormState keys.
            // Array paths (e.g., "serviceCategories.0") get attributed to
            // the parent array field.
            const root = key.split(".")[0] as keyof FormState;
            if (root in initial && !mapped[root]) {
              mapped[root] = message;
            }
          }
          if (Object.keys(mapped).length > 0) {
            setErrors(mapped);
            const firstKey = Object.keys(mapped)[0];
            const el = document.getElementById(firstKey);
            el?.scrollIntoView({ behavior: "smooth", block: "center" });
            const fieldList = Object.entries(mapped)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ");
            setServerMessage(
              `Please fix the highlighted field${
                Object.keys(mapped).length === 1 ? "" : "s"
              } — ${fieldList}`,
            );
          } else {
            setServerMessage(
              `Validation failed. Server said: ${JSON.stringify(incoming)}`,
            );
          }
        } else {
          setServerMessage(
            data?.error ||
              "We couldn't submit your request. Please try again or call us directly.",
          );
        }
        resetTurnstile();
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
      setPhotos([]);
      setPhotoErrors([]);
      jobIdRef.current = "";
      resetTurnstile();
    } catch {
      setStatus("error");
      setServerMessage(
        "Network error — please try again or call (555) 123-4567.",
      );
      resetTurnstile();
    }
  };

  if (status === "out-of-area" && outOfArea) {
    return (
      <div className="rounded-[10px] border-2 border-ink bg-[#F6EEDD] p-[30px] text-center shadow-ticket">
        <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-orange text-white">
          <Icon name="map-pin" className="h-[26px] w-[26px]" />
        </div>
        <h3 className="mt-4 font-display text-2xl font-bold">
          You&rsquo;re just outside our service area
        </h3>
        <p className="mx-auto mt-2.5 max-w-[46ch] text-[15px] text-ink-2">
          Your address looks to be about{" "}
          <span className="font-semibold">
            {outOfArea.distanceMiles} miles
          </span>{" "}
          from Garner, and we currently keep bookings within roughly{" "}
          {outOfArea.radiusMiles} miles so we can stay local and responsive.
        </p>
        <p className="mx-auto mt-3 max-w-[46ch] text-[15px] text-ink-2">
          That said — we occasionally make exceptions for bigger jobs. Give David
          a call at{" "}
          <a
            href="tel:+15551234567"
            className="font-semibold text-orange underline underline-offset-[3px]"
          >
            (555) 123-4567
          </a>{" "}
          and we&rsquo;ll see what we can do.
        </p>
        <button
          type="button"
          onClick={() => {
            setStatus("idle");
            setOutOfArea(null);
          }}
          className="mt-[18px] font-sans text-sm font-bold text-orange"
        >
          Update my address
        </button>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="rounded-[10px] border-2 border-ink bg-teal-bg p-[30px] text-center shadow-ticket">
        <div className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-full bg-teal text-white">
          <Icon name="check" className="h-[26px] w-[26px]" />
        </div>
        <h3 className="mt-4 font-display text-2xl font-bold text-[#1d4039]">
          Request received — thank you!
        </h3>
        <p className="mx-auto mt-2.5 max-w-[46ch] text-[15px] text-ink-2">
          David will review your details and get back to you shortly with a free
          estimate. For urgent requests, call us at{" "}
          <a
            href="tel:+15551234567"
            className="font-semibold text-orange underline underline-offset-[3px]"
          >
            (555) 123-4567
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-[18px] font-sans text-sm font-bold text-orange"
        >
          Submit another request
        </button>
      </div>
    );
  }

  return (
    <>
      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          async
          defer
          strategy="afterInteractive"
        />
      )}
      {GOOGLE_MAPS_API_KEY && (
        <Script
          src={`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
            GOOGLE_MAPS_API_KEY,
          )}&libraries=places&v=weekly&loading=async`}
          strategy="afterInteractive"
        />
      )}
      <form
        onSubmit={onSubmit}
        noValidate
        className="overflow-hidden rounded-[10px] border-2 border-ink bg-card shadow-ticket"
      >
        <div className="flex items-center justify-between bg-ink px-[26px] py-[18px] text-paper">
          <span className="font-display text-lg font-bold">
            Work Order Request
          </span>
          <span className="font-sans text-[12px] font-bold tracking-[0.14em] text-ember">
            FREE ESTIMATE
          </span>
        </div>
        <div className="px-[26px] pb-7 pt-2">
        {/* Honeypot */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "-9999px",
            width: "1px",
            height: "1px",
            overflow: "hidden",
          }}
        >
          <label htmlFor="website">Leave this field empty</label>
          <input
            ref={honeypotRef}
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>

        <FormSection n={1} title="About you">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name" required error={errors.name}>
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
        </FormSection>

        <FormSection n={2} title="About the property">
          <Field
            id="address"
            label="Address"
            required
            error={errors.address}
          >
            <input
              ref={addressInputRef}
              id="address"
              name="address"
              autoComplete="street-address"
              placeholder="Start typing your address…"
              value={state.address}
              onChange={(e) => update("address", e.target.value)}
              className={inputClass(!!errors.address)}
            />
            {GOOGLE_MAPS_API_KEY && (
              <p className="mt-1 text-xs text-ink/50">
                Pick a suggestion to lock in a verified address.
              </p>
            )}
          </Field>
          <Field
            id="propertyType"
            label="Property type"
            required
            error={errors.propertyType}
          >
            <select
              id="propertyType"
              name="propertyType"
              value={state.propertyType}
              onChange={(e) =>
                update("propertyType", e.target.value as PropertyTypeCode)
              }
              className={inputClass(!!errors.propertyType)}
            >
              <option value="" disabled>
                Select property type…
              </option>
              {PROPERTY_TYPES.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
        </FormSection>

        <FormSection n={3} title="What do you need help with?">
          <div>
            <label
              htmlFor="serviceCategories"
              className="mb-2 flex items-center gap-1.5 text-[13.5px] font-bold text-ink"
            >
              Services
              <span className="text-orange">*</span>
              <span className="ml-1 font-medium text-ink-3">
                (pick all that apply)
              </span>
            </label>
            <div
              id="serviceCategories"
              role="group"
              aria-labelledby="serviceCategoriesLabel"
              className="grid gap-2.5 sm:grid-cols-2"
            >
              {SERVICE_CATEGORIES.map((opt) => {
                const isSelected = state.serviceCategories.includes(opt.code);
                return (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => toggleCategory(opt.code)}
                    aria-pressed={isSelected}
                    className={`flex items-center gap-2.5 rounded-[6px] border-2 px-3.5 py-3 text-left text-sm font-medium transition-colors ${
                      isSelected
                        ? "border-orange bg-orange/[0.07] text-ink"
                        : "border-line bg-white text-ink-2 hover:border-ink-3"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] border-2 ${
                        isSelected
                          ? "border-orange bg-orange text-white"
                          : "border-line bg-white"
                      }`}
                    >
                      {isSelected && <Icon name="check" className="h-3 w-3" />}
                    </span>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
            <label className="mt-3 flex items-center gap-2.5 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={state.notSure}
                onChange={toggleNotSure}
                className="h-[17px] w-[17px] rounded border-line accent-orange"
              />
              I&rsquo;m not sure what category fits — just talk to me
            </label>
            {errors.serviceCategories && (
              <p
                className="mt-1.5 text-[12.5px] font-semibold text-red"
                role="alert"
              >
                {errors.serviceCategories}
              </p>
            )}
          </div>

          <Field
            id="description"
            label="Description of work"
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

          <div>
            <label
              htmlFor="photoInput"
              className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-bold text-ink"
            >
              Photos
              <span className="ml-1 font-medium text-ink-3">
                (optional, up to {MAX_PHOTOS})
              </span>
            </label>
            <p className="mb-3 text-[12.5px] text-ink-3">
              A picture is worth a thousand words. Snap whatever helps us
              understand the work — broken thing, room context, whatever.
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {photos.map((photo) => (
                <div
                  key={photo.id}
                  className="group relative aspect-square overflow-hidden rounded-[7px] border-2 border-line bg-paper-2"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.previewDataUrl}
                    alt={photo.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removePhoto(photo.id)}
                    className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink/[0.78] text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Remove ${photo.name}`}
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <label
                  htmlFor="photoInput"
                  className={`flex aspect-square cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[7px] border-2 border-dashed border-line bg-white text-ink-3 hover:border-ink-3 hover:text-ink ${
                    photoUploading ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  <Icon
                    name={photoUploading ? "spinner" : "camera"}
                    className={`h-[26px] w-[26px] ${photoUploading ? "animate-spin" : ""}`}
                  />
                  <span className="text-xs font-semibold">
                    {photoUploading
                      ? "Uploading…"
                      : photos.length === 0
                        ? "Add photos"
                        : `Add more (${MAX_PHOTOS - photos.length} left)`}
                  </span>
                  <input
                    ref={fileInputRef}
                    id="photoInput"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    multiple
                    disabled={photoUploading}
                    onChange={(e) => void addPhotos(e.target.files)}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            {photoErrors.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12.5px] font-semibold text-red">
                {photoErrors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        </FormSection>

        <FormSection n={4} title="When do you need this?">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="preferredDate"
              label="Preferred date"
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
            <Field
              id="urgency"
              label="Urgency"
              required
              error={errors.urgency}
            >
              <select
                id="urgency"
                name="urgency"
                value={state.urgency}
                onChange={(e) =>
                  update("urgency", e.target.value as UrgencyCode)
                }
                className={inputClass(!!errors.urgency)}
              >
                <option value="" disabled>
                  Select urgency…
                </option>
                {URGENCY_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </FormSection>

        <FormSection n={5} title="How should we reach you?">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bestContactTime" label="Best time to reach you">
              <select
                id="bestContactTime"
                name="bestContactTime"
                value={state.bestContactTime}
                onChange={(e) =>
                  update(
                    "bestContactTime",
                    e.target.value as ContactTimeCode,
                  )
                }
                className={inputClass(false)}
              >
                {CONTACT_TIMES.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="bestContactMethod" label="Preferred contact method">
              <select
                id="bestContactMethod"
                name="bestContactMethod"
                value={state.bestContactMethod}
                onChange={(e) =>
                  update(
                    "bestContactMethod",
                    e.target.value as ContactMethodCode,
                  )
                }
                className={inputClass(false)}
              >
                {CONTACT_METHODS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
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
        </FormSection>

        <div className="mt-6 space-y-4">
          {TURNSTILE_SITE_KEY && (
            <div
              className="mx-auto flex max-w-[320px] justify-center"
              ref={turnstileContainerRef}
            />
          )}

          {status === "error" && serverMessage && (
            <div
              role="alert"
              className="rounded-[5px] border-2 border-red bg-red-bg p-3 text-sm font-medium text-red"
            >
              {serverMessage}
            </div>
          )}

          <button
            type="submit"
            disabled={status === "submitting"}
            className="btn-primary w-full text-base"
          >
            {status === "submitting" ? "Sending…" : "Send My Request"}
            {status !== "submitting" && (
              <Icon name="arrow-right" className="h-4 w-4" />
            )}
          </button>
          <p className="text-center text-[12.5px] text-ink-3">
            We&rsquo;ll respond within one business day. No spam, ever.
          </p>
        </div>
        </div>
      </form>
    </>
  );
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("File read failed"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function FormSection({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border-b-2 border-dashed border-line py-6 last:border-b-0">
      <legend className="mb-[18px] flex items-center gap-3">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-orange font-display text-[15px] font-bold text-white">
          {n}
        </span>
        <span className="font-display text-xl font-bold text-ink">{title}</span>
      </legend>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

function inputClass(hasError: boolean) {
  return [
    "block w-full rounded-[5px] border-2 bg-white px-3.5 py-3 text-[15px] text-ink",
    "placeholder:text-ink-3/60",
    "focus:outline-none focus:border-orange focus:shadow-[0_0_0_3px_rgba(191,87,0,0.14)]",
    hasError ? "border-red" : "border-line",
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
        className="mb-[7px] flex items-center gap-1.5 text-[13.5px] font-bold text-ink"
      >
        {label}
        {required && <span className="text-orange">*</span>}
      </label>
      {children}
      {error && (
        <p className="mt-1.5 text-[12.5px] font-semibold text-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
