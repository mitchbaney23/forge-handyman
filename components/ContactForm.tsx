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
import { Icon, type IconName } from "@/lib/icons";
import { NailProgress } from "@/components/NailProgress";
import { compressIfNeeded } from "@/lib/photo/compress";

const MAX_PHOTOS = 6;

// Map service-category codes → existing glyphs in lib/icons.tsx.
const SERVICE_ICONS: Record<ServiceCategoryCode, IconName> = {
  mounting: "box",
  plumbing: "wrench",
  electrical: "lightbulb",
  drywall_paint: "brush",
  doors_windows: "panel",
  carpentry: "saw",
  exterior: "fence",
  maintenance: "hammer",
  multiple: "box",
  other: "handshake",
};

const PROPERTY_ICONS: Record<PropertyTypeCode, IconName> = {
  residential: "home",
  rental: "tag",
  commercial: "box",
  hoa: "shield",
  other: "handshake",
};

const URGENCY_ICONS: Record<UrgencyCode, IconName> = {
  asap: "clock",
  two_weeks: "calendar",
  month: "calendar",
  flexible: "check",
};

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

// Wizard steps — leads with the job, captures contact info last.
// `fields` drives per-step "validate before Next" + jump-to-error-on-submit.
const STEPS: {
  id: string;
  title: string;
  subtitle: string;
  fields: (keyof FormState)[];
}[] = [
  {
    id: "service",
    title: "What do you need done?",
    subtitle: "Pick all that apply — or tell us you're not sure.",
    fields: ["serviceCategories"],
  },
  {
    id: "details",
    title: "Tell us about the job",
    subtitle: "A few words (and a photo or two) help us nail the estimate.",
    fields: ["description"],
  },
  {
    id: "location",
    title: "Where's the work?",
    subtitle: "We serve Garner, Clayton & South Raleigh, NC.",
    fields: ["address", "propertyType"],
  },
  {
    id: "timing",
    title: "When works for you?",
    subtitle: "A rough timeframe is all we need.",
    fields: ["urgency"],
  },
  {
    id: "contact",
    title: "How should we reach you?",
    subtitle: "Last step — then you've nailed it.",
    fields: ["name", "phone", "email"],
  },
];

interface GoogleGeocoderResult {
  formatted_address?: string;
}

interface GoogleGeocoder {
  geocode: (
    request: { location: { lat: number; lng: number } },
    callback: (results: GoogleGeocoderResult[] | null, status: string) => void,
  ) => void;
}

// Modern Places API (New) — replaces the deprecated places.Autocomplete widget.
interface GooglePlace {
  formattedAddress?: string | null;
  fetchFields: (request: { fields: string[] }) => Promise<unknown>;
}

interface GooglePlacePrediction {
  placeId?: string;
  text?: { toString(): string };
  toPlace: () => GooglePlace;
}

interface GooglePlaceSuggestion {
  placePrediction?: GooglePlacePrediction;
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
          AutocompleteSuggestion?: {
            fetchAutocompleteSuggestions: (request: {
              input: string;
              sessionToken?: unknown;
              includedRegionCodes?: string[];
            }) => Promise<{ suggestions: GooglePlaceSuggestion[] }>;
          };
          AutocompleteSessionToken?: new () => unknown;
        };
        Geocoder?: new () => GoogleGeocoder;
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
  if (!state.urgency) errors.urgency = "Pick a rough timeframe.";
  if (!state.description.trim())
    errors.description = "Tell us a bit about the work.";
  // preferredDate is optional — urgency captures the timing.
  return errors;
}

export function ContactForm() {
  const [state, setState] = useState<FormState>(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [serverMessage, setServerMessage] = useState<string>("");
  const [outOfArea, setOutOfArea] = useState<OutOfAreaInfo | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  // Wizard navigation.
  const [step, setStep] = useState<number>(0);
  const [maxStepReached, setMaxStepReached] = useState<number>(0);
  // "Use my current location" UX state.
  const [geoStatus, setGeoStatus] = useState<
    "idle" | "locating" | "denied" | "error"
  >("idle");
  const geocoderRef = useRef<GoogleGeocoder | null>(null);
  const utmSourceRef = useRef<string>("");
  const honeypotRef = useRef<HTMLInputElement>(null);
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);
  // Address autocomplete (Places API New — replaces deprecated Autocomplete).
  const [addrSuggestions, setAddrSuggestions] = useState<
    { id: string; text: string; prediction: GooglePlacePrediction }[]
  >([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const sessionTokenRef = useRef<unknown>(null);
  const addrDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Turnstile — renders into the container on the FINAL panel. Like the
  // address input, that panel stays mounted (display:none) so this one-shot
  // effect attaches at mount and the token resolves in the background before
  // the user reaches the last step. Keep the container on the final panel so
  // any interactive challenge is visible exactly when it's needed.
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

  // ----- address autocomplete (Places API New) -----
  // Defensive: any failure (API not loaded / not enabled / network) silently
  // falls back to plain typing — the server geocodes whatever string is sent.
  const fetchAddressSuggestions = async (value: string) => {
    if (!GOOGLE_MAPS_API_KEY || value.trim().length < 3) {
      setAddrSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const places = window.google?.maps?.places;
      if (!places?.AutocompleteSuggestion) return;
      if (!sessionTokenRef.current && places.AutocompleteSessionToken) {
        sessionTokenRef.current = new places.AutocompleteSessionToken();
      }
      const { suggestions } =
        await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: value,
          sessionToken: sessionTokenRef.current ?? undefined,
          includedRegionCodes: ["us"],
        });
      const list = (suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is GooglePlacePrediction => Boolean(p))
        .slice(0, 5)
        .map((p, i) => ({
          id: p.placeId ?? String(i),
          text: p.text?.toString() ?? "",
          prediction: p,
        }))
        .filter((item) => item.text);
      setAddrSuggestions(list);
      setShowSuggestions(list.length > 0);
    } catch {
      setAddrSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const onAddressChange = (value: string) => {
    update("address", value);
    if (addrDebounceRef.current) clearTimeout(addrDebounceRef.current);
    addrDebounceRef.current = setTimeout(
      () => void fetchAddressSuggestions(value),
      250,
    );
  };

  const selectSuggestion = async (item: {
    text: string;
    prediction: GooglePlacePrediction;
  }) => {
    setShowSuggestions(false);
    setAddrSuggestions([]);
    let address = item.text;
    try {
      const place = item.prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress"] });
      if (place.formattedAddress) address = place.formattedAddress;
    } catch {
      // keep the prediction text
    }
    update("address", address);
    sessionTokenRef.current = null; // start a fresh session after a selection
  };

  // ----- wizard navigation -----
  const isLastStep = step === STEPS.length - 1;

  const goNext = () => {
    const all = validate(state);
    const fields = STEPS[step].fields;
    const firstBad = fields.find((f) => all[f]);
    if (firstBad) {
      // Surface only this step's errors (don't reveal later-step errors early).
      const stepErrors: FieldErrors = {};
      for (const f of fields) stepErrors[f] = all[f];
      setErrors((e) => ({ ...e, ...stepErrors }));
      requestAnimationFrame(() =>
        document
          .getElementById(String(firstBad))
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      );
      return;
    }
    setStep((s) => {
      const n = Math.min(s + 1, STEPS.length - 1);
      setMaxStepReached((m) => Math.max(m, n));
      return n;
    });
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  // Jump to the panel owning the first error, then scroll to it (the field
  // may be on a hidden panel, so set step before scrolling).
  const focusFirstError = (errs: FieldErrors) => {
    const firstKey = Object.keys(errs)[0] as keyof FormState | undefined;
    if (!firstKey) return;
    const owning = STEPS.findIndex((s) => s.fields.includes(firstKey));
    if (owning >= 0) {
      setStep(owning);
      setMaxStepReached((m) => Math.max(m, owning));
    }
    requestAnimationFrame(() =>
      document
        .getElementById(String(firstKey))
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  // ----- "Use my current location" -----
  const handleUseLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("error");
      return;
    }
    setGeoStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const Geocoder = window.google?.maps?.Geocoder;
        if (!Geocoder) {
          // Maps JS not ready yet — fall back to manual entry.
          setGeoStatus("error");
          return;
        }
        if (!geocoderRef.current) geocoderRef.current = new Geocoder();
        geocoderRef.current.geocode(
          { location: { lat: latitude, lng: longitude } },
          (results, gStatus) => {
            if (gStatus === "OK" && results && results[0]?.formatted_address) {
              update("address", results[0].formatted_address);
              setShowSuggestions(false);
              setGeoStatus("idle");
            } else {
              setGeoStatus("error");
            }
          },
        );
      },
      (err) => {
        setGeoStatus(err.code === err.PERMISSION_DENIED ? "denied" : "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
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
      focusFirstError(nextErrors);
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
            focusFirstError(mapped);
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
      setStep(0);
      setMaxStepReached(0);
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
        <NailProgress step={STEPS.length} totalSteps={STEPS.length} done />
        <h3 className="mt-3 font-display text-[clamp(28px,5vw,38px)] font-bold text-[#1d4039]">
          You NAILED IT! 🔨
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

        <div className="flex items-center justify-between bg-ink px-[26px] py-[18px] text-paper">
          <span className="font-display text-lg font-bold">
            Work Order Request
          </span>
          <span className="font-sans text-[12px] font-bold tracking-[0.14em] text-ember">
            FREE ESTIMATE
          </span>
        </div>

        <div className="px-[26px] pb-7 pt-5 sm:px-[26px]">
          <NailProgress step={step} totalSteps={STEPS.length} />

          <div className="mt-5">
            <h3 className="font-display text-xl font-bold text-ink">
              {STEPS[step].title}
            </h3>
            <p className="mt-1 text-sm text-ink-2">{STEPS[step].subtitle}</p>
          </div>

          <div className="mt-5">
            {/* Step 1 — Service */}
            <div hidden={step !== 0} className="panel-enter space-y-3">
              <ChoiceGroup
                idBase="serviceCategories"
                multi
                options={SERVICE_CATEGORIES.map((o) => ({
                  code: o.code,
                  label: o.label,
                  icon: SERVICE_ICONS[o.code],
                }))}
                selected={state.serviceCategories}
                onToggle={(c) => toggleCategory(c as ServiceCategoryCode)}
                error={errors.serviceCategories}
              />
              <button
                type="button"
                onClick={toggleNotSure}
                aria-pressed={state.notSure}
                className={`flex w-full items-center gap-3 rounded-[7px] border-2 px-3.5 py-3 text-left text-sm font-semibold transition-colors ${
                  state.notSure
                    ? "border-orange bg-orange/[0.07] text-ink"
                    : "border-line bg-white text-ink-2 hover:border-ink-3"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] border-2 ${
                    state.notSure
                      ? "border-orange bg-orange text-white"
                      : "border-line bg-white"
                  }`}
                >
                  {state.notSure && <Icon name="check" className="h-3 w-3" />}
                </span>
                I&rsquo;m not sure what fits — just talk to me
              </button>
            </div>

            {/* Step 2 — Details */}
            <div hidden={step !== 1} className="panel-enter space-y-5">
              <Field
                id="description"
                label="Describe the work"
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
                  understand the work.
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
            </div>

            {/* Step 3 — Location */}
            <div hidden={step !== 2} className="panel-enter space-y-5">
              <Field id="address" label="Address" required error={errors.address}>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <input
                      id="address"
                      name="address"
                      autoComplete="off"
                      placeholder="Start typing your address…"
                      value={state.address}
                      onChange={(e) => onAddressChange(e.target.value)}
                      onFocus={() =>
                        setShowSuggestions(addrSuggestions.length > 0)
                      }
                      onBlur={() =>
                        setTimeout(() => setShowSuggestions(false), 150)
                      }
                      role="combobox"
                      aria-expanded={showSuggestions}
                      aria-autocomplete="list"
                      className={inputClass(!!errors.address)}
                    />
                    {showSuggestions && addrSuggestions.length > 0 && (
                      <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-[7px] border-2 border-ink bg-card shadow-card">
                        {addrSuggestions.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              // onMouseDown (not onClick) so it fires before the input's blur
                              onMouseDown={(e) => {
                                e.preventDefault();
                                void selectSuggestion(item);
                              }}
                              className="flex w-full items-center gap-2.5 border-b border-dashed border-line px-3.5 py-2.5 text-left text-[14px] text-ink-2 last:border-b-0 hover:bg-orange/[0.07] hover:text-ink"
                            >
                              <Icon
                                name="map-pin"
                                className="h-4 w-4 flex-none text-orange"
                              />
                              <span className="truncate">{item.text}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleUseLocation}
                    disabled={geoStatus === "locating"}
                    className="btn-outline shrink-0 whitespace-nowrap px-4 py-3 text-sm"
                  >
                    <Icon
                      name={geoStatus === "locating" ? "spinner" : "map-pin"}
                      className={`h-4 w-4 ${geoStatus === "locating" ? "animate-spin" : ""}`}
                    />
                    {geoStatus === "locating" ? "Locating…" : "Use my location"}
                  </button>
                </div>
                {geoStatus === "denied" && (
                  <p className="mt-1.5 text-[12.5px] text-ink-3">
                    We couldn&rsquo;t access your location — just type your
                    address instead.
                  </p>
                )}
                {geoStatus === "error" && (
                  <p className="mt-1.5 text-[12.5px] text-ink-3">
                    Couldn&rsquo;t pin your location — type your address and pick
                    a suggestion.
                  </p>
                )}
                {GOOGLE_MAPS_API_KEY && geoStatus === "idle" && (
                  <p className="mt-1.5 text-[12.5px] text-ink-3">
                    Pick a suggestion to lock in a verified address.
                  </p>
                )}
              </Field>

              <div>
                <label className="mb-2 block text-[13.5px] font-bold text-ink">
                  Property type <span className="text-orange">*</span>
                </label>
                <ChoiceGroup
                  idBase="propertyType"
                  options={PROPERTY_TYPES.map((o) => ({
                    code: o.code,
                    label: o.label,
                    icon: PROPERTY_ICONS[o.code],
                  }))}
                  selected={state.propertyType ? [state.propertyType] : []}
                  onToggle={(c) =>
                    update("propertyType", c as PropertyTypeCode)
                  }
                  error={errors.propertyType}
                />
              </div>
            </div>

            {/* Step 4 — Timing */}
            <div hidden={step !== 3} className="panel-enter space-y-5">
              <div>
                <label className="mb-2 block text-[13.5px] font-bold text-ink">
                  How soon? <span className="text-orange">*</span>
                </label>
                <ChoiceGroup
                  idBase="urgency"
                  options={URGENCY_OPTIONS.map((o) => ({
                    code: o.code,
                    label: o.label,
                    icon: URGENCY_ICONS[o.code],
                  }))}
                  selected={state.urgency ? [state.urgency] : []}
                  onToggle={(c) => update("urgency", c as UrgencyCode)}
                  error={errors.urgency}
                />
              </div>
              <Field id="preferredDate" label="Want a specific day? (optional)">
                <input
                  id="preferredDate"
                  name="preferredDate"
                  type="date"
                  value={state.preferredDate}
                  min={new Date().toISOString().split("T")[0]}
                  onChange={(e) => update("preferredDate", e.target.value)}
                  className={inputClass(false)}
                />
              </Field>
            </div>

            {/* Step 5 — Contact */}
            <div hidden={step !== 4} className="panel-enter space-y-5">
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

              <div className="border-t-2 border-dashed border-line pt-4">
                <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.1em] text-ink-3">
                  Optional — helps us reach you faster
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-[13.5px] font-bold text-ink">
                      Best time to reach you
                    </label>
                    <ChoiceGroup
                      idBase="bestContactTime"
                      options={CONTACT_TIMES.map((o) => ({
                        code: o.code,
                        label: o.label,
                      }))}
                      selected={[state.bestContactTime]}
                      onToggle={(c) =>
                        update("bestContactTime", c as ContactTimeCode)
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[13.5px] font-bold text-ink">
                      Preferred contact method
                    </label>
                    <ChoiceGroup
                      idBase="bestContactMethod"
                      options={CONTACT_METHODS.map((o) => ({
                        code: o.code,
                        label: o.label,
                      }))}
                      selected={[state.bestContactMethod]}
                      onToggle={(c) =>
                        update("bestContactMethod", c as ContactMethodCode)
                      }
                    />
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
                </div>
              </div>

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
            </div>
          </div>

          {/* Footer — Back / Next / Submit */}
          <div className="mt-7 flex items-center gap-3">
            {step > 0 && (
              <button
                type="button"
                onClick={goBack}
                className="btn-outline"
              >
                <Icon name="arrow-left" className="h-4 w-4" />
                Back
              </button>
            )}
            {!isLastStep ? (
              <button
                type="button"
                onClick={goNext}
                className="btn-primary ml-auto"
              >
                Next
                <Icon name="arrow-right" className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={status === "submitting"}
                className="btn-primary ml-auto"
              >
                {status === "submitting" ? "Sending…" : "Send My Request"}
                {status !== "submitting" && (
                  <Icon name="arrow-right" className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
          {isLastStep && (
            <p className="mt-3 text-center text-[12.5px] text-ink-3">
              We&rsquo;ll respond within one business day. No spam, ever.
            </p>
          )}
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

function ChoiceGroup({
  idBase,
  options,
  selected,
  onToggle,
  multi = false,
  error,
}: {
  idBase: string;
  options: { code: string; label: string; icon?: IconName }[];
  selected: string[];
  onToggle: (code: string) => void;
  multi?: boolean;
  error?: string;
}) {
  return (
    <div>
      <div id={idBase} role="group" className="grid gap-2.5 sm:grid-cols-2">
        {options.map((opt) => {
          const isSel = selected.includes(opt.code);
          return (
            <button
              key={opt.code}
              type="button"
              aria-pressed={isSel}
              onClick={() => onToggle(opt.code)}
              className={`flex items-center gap-3 rounded-[7px] border-2 px-3.5 py-3 text-left text-sm font-semibold transition-colors ${
                isSel
                  ? "border-orange bg-orange/[0.07] text-ink"
                  : "border-line bg-white text-ink-2 hover:border-ink-3"
              }`}
            >
              {opt.icon && (
                <span
                  className={`flex h-9 w-9 flex-none items-center justify-center rounded-md ${
                    isSel ? "bg-orange text-white" : "bg-paper-2 text-ink-2"
                  }`}
                >
                  <Icon name={opt.icon} className="h-[18px] w-[18px]" />
                </span>
              )}
              <span className="min-w-0">{opt.label}</span>
              <span
                aria-hidden="true"
                className={`ml-auto flex h-5 w-5 flex-none items-center justify-center border-2 ${
                  multi ? "rounded-[5px]" : "rounded-full"
                } ${
                  isSel ? "border-orange bg-orange text-white" : "border-line bg-white"
                }`}
              >
                {isSel && <Icon name="check" className="h-3 w-3" />}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="mt-1.5 text-[12.5px] font-semibold text-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
