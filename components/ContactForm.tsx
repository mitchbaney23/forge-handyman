"use client";

import Script from "next/script";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  BUSINESS,
  PROPERTY_TYPES,
  REFERRAL_SOURCES,
  SERVICE_MENU,
  SERVICE_PACKAGES,
  URGENCY_OPTIONS,
  type PropertyTypeCode,
  type UrgencyCode,
} from "@/lib/constants";
import {
  cartJobMinutes,
  cartTotals,
  isCartEmpty,
  suggestPackage,
  type Cart,
} from "@/lib/cart";
import { familyPriceLabel, FAMILY_DISCOUNT_LABEL } from "@/lib/family-pricing";
import { formatEtDay, formatEtTime } from "@/lib/scheduling/time";
import { Icon, type IconName } from "@/lib/icons";
import { NailProgress } from "@/components/NailProgress";
import { compressIfNeeded } from "@/lib/photo/compress";

const MAX_PHOTOS = 6;

// Map menu section names → existing glyphs in lib/icons.tsx, for the cart
// section headers. Mirrors the `icon` field on each SERVICE_MENU section.
const SECTION_ICONS: Record<string, IconName> = {
  hammer: "hammer",
  box: "box",
  brush: "brush",
  wrench: "wrench",
  panel: "panel",
  car: "car",
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

type SelectedSlot = { startsAt: string; endsAt: string };

type FormState = {
  name: string;
  phone: string;
  email: string;
  address: string;
  propertyType: PropertyTypeCode | "";
  cart: Cart;
  notSure: boolean;
  description: string;
  // Optional access details for the visit (gate code, parking, pets, lockbox).
  // Folded into the job description server-side so David sees it on the
  // dispatch card without a schema change.
  accessNotes: string;
  preferredDate: string;
  urgency: UrgencyCode | "";
  // A chosen appointment slot (self-scheduling). null on the fallback/custom
  // path, where urgency/preferredDate carry the timing instead.
  selectedSlot: SelectedSlot | null;
  // True when the customer is on the "request a callback" timing path (custom
  // job, no fitting slot, or "none of these work") rather than the slot picker.
  useFallbackTiming: boolean;
  referralSource: string;
  // Forge Family friends-and-family pricing, set from the /family link
  // (?family=1) — shows discounted prices through the cart + tags the lead.
  family: boolean;
};

const initial: FormState = {
  name: "",
  phone: "",
  email: "",
  address: "",
  propertyType: "",
  cart: { items: [], packageNumber: null },
  notSure: false,
  description: "",
  accessNotes: "",
  preferredDate: "",
  urgency: "",
  selectedSlot: null,
  useFallbackTiming: false,
  referralSource: "",
  family: false,
};

// Shape returned by /api/scheduling/availability.
type AvailabilityResponse = {
  slotsByDay: { dayISO: string; slots: SelectedSlot[] }[];
  tooLongForWindow?: boolean;
  noTechnician?: boolean;
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
    title: "Build your job",
    subtitle: "Pick what you need — or tell us you're not sure.",
    fields: ["cart"],
  },
  {
    id: "details",
    title: "Tell us about the job",
    subtitle: "A quick photo of the spot helps us arrive ready — add one below.",
    fields: ["description"],
  },
  {
    id: "location",
    title: "Where's the work?",
    subtitle: "We serve Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs & Fuquay-Varina, NC.",
    fields: ["address", "propertyType"],
  },
  {
    id: "timing",
    title: "Pick your time",
    subtitle: "Choose a real opening — or tell us your timeframe.",
    fields: ["selectedSlot", "urgency"],
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
  if (!state.notSure && isCartEmpty(state.cart))
    errors.cart =
      "Pick at least one service or a package, or check “I'm not sure.”";
  // Timing: on the slot-picker path a selected slot is required; on the
  // fallback/callback path (custom job, no fitting slot, or "none of these
  // work") a rough timeframe is required instead. A custom cart is always
  // fallback regardless of the stored flag.
  const canScheduleTiming =
    !state.notSure && !isCartEmpty(state.cart) && cartJobMinutes(state.cart) > 0;
  if (!canScheduleTiming || state.useFallbackTiming) {
    if (!state.urgency) errors.urgency = "Pick a rough timeframe.";
  } else if (!state.selectedSlot) {
    errors.selectedSlot = "Please choose an appointment time.";
  }
  // Description is required only on the "not sure / custom job" path — there
  // the text IS the job. When they've picked menu items, the cart already says
  // what the job is, so notes are optional.
  if (state.notSure && !state.description.trim())
    errors.description =
      "Since you're not sure, a few words about the job helps us help you.";
  // preferredDate is optional — urgency captures the timing.
  return errors;
}

export function ContactForm({ initialFamily = false }: { initialFamily?: boolean }) {
  const [state, setState] = useState<FormState>(() => ({
    ...initial,
    family: initialFamily,
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>("idle");
  const [serverMessage, setServerMessage] = useState<string>("");
  const [outOfArea, setOutOfArea] = useState<OutOfAreaInfo | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  // Wizard navigation.
  const [step, setStep] = useState<number>(0);
  const [maxStepReached, setMaxStepReached] = useState<number>(0);
  // Self-scheduling (timing step). Availability is fetched on entering that step.
  const [slotData, setSlotData] = useState<AvailabilityResponse | null>(null);
  const [slotLoading, setSlotLoading] = useState<boolean>(false);
  const [slotError, setSlotError] = useState<boolean>(false);
  // Set on a successful booking so the success screen can show the firm time.
  const [bookedSlot, setBookedSlot] = useState<SelectedSlot | null>(null);
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

  // A known-duration cart (not the custom/"not sure" path) can self-schedule.
  const canSchedule = !state.notSure && !isCartEmpty(state.cart) && cartJobMinutes(state.cart) > 0;
  const family = state.family;
  // Render a price with the Forge Family treatment: base struck through, the
  // discounted price in orange. Plain base price when not a family booking.
  const renderPrice = (baseDisplay: string, baseCents: number) =>
    family ? (
      <>
        <span className="font-normal text-ink-3 line-through">{baseDisplay}</span>{" "}
        <span className="text-orange">{familyPriceLabel(baseDisplay, baseCents)}</span>
      </>
    ) : (
      <>{baseDisplay}</>
    );
  // True when the slot picker has real openings to show (vs. the callback fallback).
  const pickerAvailable =
    !!slotData &&
    !slotData.tooLongForWindow &&
    !slotData.noTechnician &&
    !slotError &&
    slotData.slotsByDay.some((d) => d.slots.length > 0);

  // Fetch the technician's open slots for the current cart. On anything that
  // means "no self-serve slots" (too-long job, no technician, no openings, or an
  // error) we switch the timing step to the callback fallback so a lead is never
  // lost.
  async function fetchAvailability(): Promise<void> {
    setSlotLoading(true);
    setSlotError(false);
    const cartParam = encodeURIComponent(JSON.stringify(state.cart));
    // Retry a few times before giving up to the callback fallback. The first hit
    // can cold-start the serverless function or catch a transient Google Calendar
    // blip; without a retry that dumped the customer straight to "tell us your
    // timeframe" (the "couldn't see times until the 3rd/4th try" report).
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await fetch(`/api/scheduling/availability?cart=${cartParam}`);
        if (!res.ok) throw new Error(`availability ${res.status}`);
        const data = (await res.json()) as AvailabilityResponse;
        setSlotData(data);
        const hasSlots = (data.slotsByDay ?? []).some((d) => d.slots.length > 0);
        if (!hasSlots || data.tooLongForWindow || data.noTechnician) {
          setState((s) => ({ ...s, useFallbackTiming: true, selectedSlot: null }));
        } else {
          setState((s) => {
            // Drop a stale selection that's no longer offered (e.g. cart changed).
            const stillOffered =
              s.selectedSlot != null &&
              data.slotsByDay.some((d) =>
                d.slots.some((sl) => sl.startsAt === s.selectedSlot!.startsAt),
              );
            return {
              ...s,
              useFallbackTiming: false,
              selectedSlot: stillOffered ? s.selectedSlot : null,
            };
          });
        }
        setSlotLoading(false);
        return; // success — done
      } catch {
        if (attempt < MAX_ATTEMPTS) {
          // brief backoff, then retry (covers cold start / transient blip)
          await new Promise((r) => setTimeout(r, 500 * attempt));
          continue;
        }
        // Exhausted retries — fall back to the callback path (recoverable via
        // the "Try again" button on the timing step).
        setSlotError(true);
        setState((s) => ({ ...s, useFallbackTiming: true }));
        setSlotLoading(false);
      }
    }
  }

  // On entering the timing step (index 3), load availability for a schedulable
  // cart; a custom/unschedulable cart goes straight to the callback fallback.

  // Turnstile — render the widget only once the FINAL panel is actually
  // VISIBLE (the user reaches the contact step). The panels stay mounted via
  // `hidden` (display:none), and Cloudflare Turnstile rendered into a
  // display:none container measures 0×0 — so an interactive challenge never
  // appears and the user hits "complete the verification challenge" with
  // nothing to complete. Gating on `step` fixes that; the cleanup tears the
  // widget down when leaving the step and it re-renders fresh on return.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    if (step !== STEPS.length - 1) return;
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
  }, [step]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((s) => ({ ...s, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const clearCartError = () => {
    if (errors.cart) setErrors((e) => ({ ...e, cart: undefined }));
  };

  // Toggle an à-la-carte menu item. Selecting any item clears the package and
  // "I'm not sure". Selecting an already-selected item removes it.
  const toggleItem = (id: string) => {
    setState((s) => {
      const has = s.cart.items.some((it) => it.id === id);
      const items = has
        ? s.cart.items.filter((it) => it.id !== id)
        : [...s.cart.items, { id, qty: 1 }];
      return {
        ...s,
        cart: { items, packageNumber: null },
        notSure: false,
      };
    });
    clearCartError();
  };

  // Select / deselect a package (radio-like). Selecting one clears à-la-carte
  // items and "I'm not sure"; selecting the active one again deselects it.
  const togglePackage = (packageNumber: number) => {
    setState((s) => {
      const active = s.cart.packageNumber === packageNumber;
      return {
        ...s,
        cart: {
          items: [],
          packageNumber: active ? null : packageNumber,
        },
        notSure: false,
      };
    });
    clearCartError();
  };

  // Accept the package nudge — swap the à-la-carte list for the suggested pkg.
  const acceptPackage = (packageNumber: number) => {
    setState((s) => ({
      ...s,
      cart: { items: [], packageNumber },
      notSure: false,
    }));
    clearCartError();
  };

  const toggleNotSure = () => {
    setState((s) => ({
      ...s,
      notSure: !s.notSure,
      // Clear the cart when picking "not sure".
      cart: !s.notSure ? { items: [], packageNumber: null } : s.cart,
    }));
    clearCartError();
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
    const next = Math.min(step + 1, STEPS.length - 1);
    setStep(next);
    setMaxStepReached((m) => Math.max(m, next));
    // Advancing INTO the timing step: load live availability for a schedulable
    // cart (event-driven, so we don't setState from an effect). goBack / submit
    // jumps reuse the cached slots already in state.
    if (next === 3 && canSchedule) void fetchAvailability();
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
          cart: state.cart,
          notSure: state.notSure,
          family: state.family,
          description: state.description,
          accessNotes: state.accessNotes || undefined,
          preferredDate: state.preferredDate,
          urgency: state.urgency || undefined,
          selectedSlot:
            !state.useFallbackTiming && state.selectedSlot
              ? state.selectedSlot
              : undefined,
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
        // A slot was taken between loading and submitting — send the customer
        // back to the timing step with fresh availability to repick.
        if (response.status === 409 && data?.refreshAvailability) {
          setStatus("idle");
          setState((s) => ({ ...s, selectedSlot: null }));
          setErrors({ selectedSlot: "That time was just taken — please pick another." });
          setStep(3);
          setMaxStepReached((m) => Math.max(m, 3));
          void fetchAvailability();
          resetTurnstile();
          return;
        }
        setStatus("error");
        // Maintenance kill switch — friendly, distinct from a generic error.
        if (data?.maintenance) {
          setServerMessage(
            data?.error ||
              `We're updating our booking system right now. Please call us at ${BUSINESS.phone}.`,
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
            // Nested paths (e.g., "cart.items.0.id") get attributed to the
            // parent field (e.g., "cart").
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
        // The server already verified (and consumed) the Turnstile token before
        // the service-area check, so a corrected re-submit must get a FRESH
        // token — otherwise it re-sends a spent one and the server 403s. This is
        // the one success-ish path that was missing the reset.
        resetTurnstile();
        return;
      }
      setBookedSlot(
        data?.booked?.startsAt && data?.booked?.endsAt
          ? { startsAt: data.booked.startsAt, endsAt: data.booked.endsAt }
          : null,
      );
      setStatus("success");
      setState(initial);
      setStep(0);
      setMaxStepReached(0);
      setPhotos([]);
      setPhotoErrors([]);
      setSlotData(null);
      jobIdRef.current = "";
      resetTurnstile();
    } catch {
      setStatus("error");
      setServerMessage(
        `Network error — please try again or call ${BUSINESS.phone}.`,
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
            href={BUSINESS.phoneHref}
            className="font-semibold text-orange underline underline-offset-[3px]"
          >
            {BUSINESS.phone}
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
        {bookedSlot ? (
          <p className="mx-auto mt-2.5 max-w-[46ch] text-[15px] text-ink-2">
            You&rsquo;re booked for{" "}
            <span className="font-semibold text-[#1d4039]">
              {formatEtDay(new Date(bookedSlot.startsAt))} at{" "}
              {formatEtTime(new Date(bookedSlot.startsAt))}
            </span>
            . David will see you then — we&rsquo;ll text if anything changes. Need
            to adjust? Call{" "}
            <a
              href={BUSINESS.phoneHref}
              className="font-semibold text-orange underline underline-offset-[3px]"
            >
              {BUSINESS.phone}
            </a>
            .
          </p>
        ) : (
          <p className="mx-auto mt-2.5 max-w-[46ch] text-[15px] text-ink-2">
            David will review your details and get back to you shortly with a free
            estimate. For urgent requests, call us at{" "}
            <a
              href={BUSINESS.phoneHref}
              className="font-semibold text-orange underline underline-offset-[3px]"
            >
              {BUSINESS.phone}
            </a>
            .
          </p>
        )}
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

          {family && (
            <div className="mt-4 flex items-center gap-2 rounded-[7px] border-2 border-orange bg-orange/[0.07] px-3.5 py-2.5">
              <Icon name="hammer" className="h-4 w-4 flex-none text-orange" />
              <p className="text-[13px] font-semibold text-ink">
                Forge Family — {FAMILY_DISCOUNT_LABEL} off applied to every price.
              </p>
            </div>
          )}

          <div className="mt-5">
            {/* Step 1 — Service (the cart picker) */}
            <div hidden={step !== 0} className="panel-enter space-y-4">
              <div
                id="cart"
                className={`space-y-4 transition-opacity ${
                  state.notSure ? "pointer-events-none opacity-45" : ""
                }`}
                aria-disabled={state.notSure}
              >
                {/* Packages — pick one and we knock out the whole list. */}
                <div>
                  <p className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-ink-3">
                    Book a block of time
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-3">
                    {SERVICE_PACKAGES.map((pkg) => {
                      const isSel = state.cart.packageNumber === pkg.number;
                      return (
                        <button
                          key={pkg.number}
                          type="button"
                          aria-pressed={isSel}
                          onClick={() => togglePackage(pkg.number)}
                          className={`flex flex-col rounded-[7px] border-2 px-3.5 py-3 text-left transition-colors ${
                            isSel
                              ? "border-orange bg-orange/[0.07]"
                              : "border-line bg-white hover:border-ink-3"
                          }`}
                        >
                          <span className="flex items-center justify-between">
                            <span className="font-display text-base font-bold text-ink">
                              #{pkg.number} {pkg.name}
                            </span>
                            <span
                              aria-hidden="true"
                              className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 ${
                                isSel
                                  ? "border-orange bg-orange text-white"
                                  : "border-line bg-white"
                              }`}
                            >
                              {isSel && (
                                <Icon name="check" className="h-3 w-3" />
                              )}
                            </span>
                          </span>
                          <span className="mt-0.5 text-[13px] font-semibold text-ink-2">
                            {pkg.hours} hrs · {renderPrice(pkg.price, pkg.priceCents)}
                          </span>
                          <span className="mt-1 text-[12.5px] text-ink-3">
                            {pkg.blurb}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* À-la-carte menu — pick individual jobs. */}
                <div className="space-y-3 border-t-2 border-dashed border-line pt-4">
                  <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-ink-3">
                    Or pick individual jobs
                  </p>
                  {SERVICE_MENU.map((section) => (
                    <div key={section.category}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-paper-2 text-ink-2">
                          <Icon
                            name={SECTION_ICONS[section.icon] ?? "hammer"}
                            className="h-4 w-4"
                          />
                        </span>
                        <span className="text-[13.5px] font-bold text-ink">
                          {section.category}
                        </span>
                      </div>
                      {section.note && (
                        <p className="mb-2 text-[12px] italic leading-snug text-ink-3">
                          {section.note}
                        </p>
                      )}
                      <div className="space-y-2">
                        {section.items.map((item) => {
                          const isSel = state.cart.items.some(
                            (it) => it.id === item.id,
                          );
                          return (
                            <button
                              key={item.id}
                              type="button"
                              aria-pressed={isSel}
                              onClick={() => toggleItem(item.id)}
                              className={`flex w-full items-center gap-3 rounded-[7px] border-2 px-3.5 py-2.5 text-left text-sm transition-colors ${
                                isSel
                                  ? "border-orange bg-orange/[0.07] text-ink"
                                  : "border-line bg-white text-ink-2 hover:border-ink-3"
                              }`}
                            >
                              <span
                                aria-hidden="true"
                                className={`flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border-2 ${
                                  isSel
                                    ? "border-orange bg-orange text-white"
                                    : "border-line bg-white"
                                }`}
                              >
                                {isSel && (
                                  <Icon name="check" className="h-3 w-3" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1 font-semibold">
                                {item.name}
                              </span>
                              <span className="flex-none font-bold text-ink">
                                {renderPrice(item.price, item.priceCents)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Package nudge — gentle upsell when the list crosses ~2 hrs. */}
              {!state.notSure &&
                (() => {
                  const pkg = suggestPackage(state.cart);
                  if (!pkg) return null;
                  return (
                    <div className="flex flex-col gap-2.5 rounded-[7px] border-2 border-orange bg-orange/[0.07] p-3.5 sm:flex-row sm:items-center">
                      <Icon
                        name="hammer"
                        className="h-5 w-5 flex-none text-orange"
                      />
                      <p className="flex-1 text-[13.5px] text-ink">
                        You&rsquo;ve got enough for{" "}
                        <span className="font-bold">
                          {pkg.name} (
                          {family
                            ? familyPriceLabel(pkg.price, pkg.priceCents)
                            : pkg.price}
                          )
                        </span>{" "}
                        — switch and we&rsquo;ll knock out the whole list.
                      </p>
                      <button
                        type="button"
                        onClick={() => acceptPackage(pkg.number)}
                        className="btn-primary shrink-0 whitespace-nowrap px-4 py-2 text-sm"
                      >
                        Switch to #{pkg.number}
                      </button>
                    </div>
                  );
                })()}

              {/* Running summary. */}
              {!state.notSure &&
                !isCartEmpty(state.cart) &&
                (() => {
                  if (state.cart.packageNumber != null) {
                    const pkg = SERVICE_PACKAGES.find(
                      (p) => p.number === state.cart.packageNumber,
                    );
                    if (!pkg) return null;
                    return (
                      <div className="flex items-center justify-between rounded-[7px] border-2 border-ink bg-paper-2 px-3.5 py-2.5 text-sm font-bold text-ink">
                        <span>
                          #{pkg.number} {pkg.name}
                        </span>
                        <span>
                          {pkg.hours} hrs · {renderPrice(pkg.price, pkg.priceCents)}
                        </span>
                      </div>
                    );
                  }
                  const totals = cartTotals(state.cart);
                  const famSubtotalCents = family
                    ? cartTotals(state.cart, { family: true }).subtotalCents
                    : totals.subtotalCents;
                  const hrs = Math.round((totals.minutes / 60) * 10) / 10;
                  return (
                    <div className="flex items-center justify-between rounded-[7px] border-2 border-ink bg-paper-2 px-3.5 py-2.5 text-sm font-bold text-ink">
                      <span>
                        {totals.itemCount} item
                        {totals.itemCount === 1 ? "" : "s"} · ~{hrs} hrs
                      </span>
                      <span>
                        {family && (
                          <span className="mr-1.5 font-normal text-ink-3 line-through">
                            ${totals.subtotalCents / 100}
                          </span>
                        )}
                        <span className={family ? "text-orange" : undefined}>
                          ${famSubtotalCents / 100}
                        </span>
                      </span>
                    </div>
                  );
                })()}

              {errors.cart && (
                <p
                  className="text-[12.5px] font-semibold text-red"
                  role="alert"
                >
                  {errors.cart}
                </p>
              )}

              {/* "I'm not sure / custom job" toggle. */}
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
                I&rsquo;m not sure / it&rsquo;s a custom job — just talk to me
              </button>
            </div>

            {/* Step 2 — Details */}
            <div hidden={step !== 1} className="panel-enter space-y-5">
              <Field
                id="description"
                label={
                  state.notSure
                    ? "Describe the work"
                    : "Anything we should know? (optional)"
                }
                required={state.notSure}
                error={errors.description}
              >
                <textarea
                  id="description"
                  name="description"
                  rows={5}
                  placeholder={
                    state.notSure
                      ? "Tell us what needs doing. Be as specific as you like — the more detail, the better we can help."
                      : "Optional — anything special about the space, access, parking, or the spot itself."
                  }
                  value={state.description}
                  onChange={(e) => update("description", e.target.value)}
                  className={inputClass(!!errors.description)}
                />
              </Field>

              <Field id="accessNotes" label="Getting in (optional)">
                <input
                  id="accessNotes"
                  name="accessNotes"
                  type="text"
                  maxLength={300}
                  placeholder="Gate code, parking, pets, lockbox — anything David needs on arrival."
                  value={state.accessNotes}
                  onChange={(e) => update("accessNotes", e.target.value)}
                  className={inputClass(false)}
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
                  A quick photo of the spot lets us arrive with the right parts
                  and tools — and confirm the flat rate fits before we book.
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
              {slotLoading ? (
                <div className="flex items-center gap-2.5 py-4 text-[14px] text-ink-2">
                  <Icon name="spinner" className="h-5 w-5 animate-spin" />
                  Finding open times…
                </div>
              ) : !state.useFallbackTiming && pickerAvailable && slotData ? (
                <div className="space-y-4">
                  <p className="text-[13.5px] text-ink-2">
                    Pick an open time and you&rsquo;re booked — no callback needed.
                  </p>
                  {slotData.slotsByDay.map((day) => (
                    <div key={day.dayISO}>
                      <h4 className="mb-2 text-[13.5px] font-bold text-ink">
                        {formatEtDay(new Date(day.slots[0].startsAt))}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {day.slots.map((slot) => {
                          const sel = state.selectedSlot?.startsAt === slot.startsAt;
                          return (
                            <button
                              key={slot.startsAt}
                              type="button"
                              aria-pressed={sel}
                              onClick={() =>
                                setState((s) => ({ ...s, selectedSlot: slot }))
                              }
                              className={`rounded-[7px] border-2 px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                                sel
                                  ? "border-ink bg-ink text-white"
                                  : "border-line bg-white text-ink hover:border-ink-3"
                              }`}
                            >
                              {formatEtTime(new Date(slot.startsAt))}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {errors.selectedSlot && (
                    <p className="text-[12.5px] font-semibold text-red" role="alert">
                      {errors.selectedSlot}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        useFallbackTiming: true,
                        selectedSlot: null,
                      }))
                    }
                    className="text-[13px] font-semibold text-ink-3 underline underline-offset-2 hover:text-ink"
                  >
                    None of these work / I&rsquo;m flexible
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  {slotError ? (
                    <div className="space-y-2">
                      <p className="text-[12.5px] text-ink-3">
                        We couldn&rsquo;t load live times just now — try again, or
                        tell us your timeframe below and we&rsquo;ll call to
                        schedule.
                      </p>
                      <button
                        type="button"
                        onClick={() => void fetchAvailability()}
                        className="text-[13px] font-semibold text-orange underline underline-offset-2 hover:text-ink"
                      >
                        ↻ Try loading times again
                      </button>
                    </div>
                  ) : canSchedule ? null : (
                    <p className="text-[12.5px] text-ink-3">
                      For a custom job we&rsquo;ll call to find a time that works.
                    </p>
                  )}
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
                  {pickerAvailable && (
                    <button
                      type="button"
                      onClick={() =>
                        setState((s) => ({ ...s, useFallbackTiming: false }))
                      }
                      className="text-[13px] font-semibold text-ink-3 underline underline-offset-2 hover:text-ink"
                    >
                      ← Back to available times
                    </button>
                  )}
                </div>
              )}
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
                <Field id="referralSource" label="How did you hear about us? (optional)">
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
