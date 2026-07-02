export const BUSINESS = {
  name: "Forge Handyman Service",
  tagline: "Honest Work. Built to Last.",
  phone: "(919) 275-2823",
  phoneHref: "tel:+19192752823",
  email: "david@forgehandyman.com",
  emailHref: "mailto:david@forgehandyman.com",
  owner: "David Baney",
  manager: "Mitch Baney",
  city: "Garner",
  region: "NC",
  country: "US",
  serviceAreaLine: "Serving Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs & Fuquay-Varina, NC",
  // CAN-SPAM requires a valid physical postal address in commercial email,
  // and the legal pages reference it.
  mailingAddress: "2012 Raccoon Run, Clayton, NC 27527",
  hours: [
    { day: "Monday – Friday", time: "8:00 AM – 6:00 PM" },
    { day: "Saturday", time: "9:00 AM – 2:00 PM" },
    { day: "Sunday", time: "Closed" },
  ],
  hoursStructured: [
    { days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "08:00", closes: "18:00" },
    { days: ["Saturday"], opens: "09:00", closes: "14:00" },
  ],
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://forgehandyman.com",
};

export const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export type ServiceKey =
  | "general-repairs"
  | "install-assembly"
  | "paint-drywall"
  | "minor-plumbing"
  | "tv-mounting"
  | "auto-maintenance";

export type Service = {
  key: ServiceKey;
  title: string;
  short: string;
  long: string;
  icon: string;
  category: ServiceCategory;
};

// The service sections (the "menu" sections). Outdoor & seasonal work
// (decks, fences, pressure washing) was dropped 2026-06 to focus the offering.
// Auto Maintenance added 2026-06 — driveway car care that needs no lift.
export type ServiceCategory =
  | "General Repairs"
  | "Installation & Furniture Assembly"
  | "Painting & Drywall Repair"
  | "Minor Plumbing"
  | "TV Mounting"
  | "Auto Maintenance";

// Homepage "what we do" cards — one per menu section.
export const SERVICES: Service[] = [
  {
    key: "general-repairs",
    title: "General Repairs",
    short: "Sticky doors, worn door knobs, fresh caulk — the nagging fixes, done.",
    long:
      "Sticking doors, fresh caulk, door knobs and hardware, and the growing list of small repairs most homeowners never get to. One visit, one invoice, done right.",
    icon: "hammer",
    category: "General Repairs",
  },
  {
    key: "install-assembly",
    title: "Installation & Assembly",
    short: "Ceiling fans, fixtures, shelving, and the flat-pack still in the box.",
    long:
      "Ceiling fans, light fixtures, shelving, mirrors, hardware, and flat-pack furniture — assembled and installed level, solid, and tested before we leave.",
    icon: "box",
    category: "Installation & Furniture Assembly",
  },
  {
    key: "paint-drywall",
    title: "Painting & Drywall",
    short: "Patches that disappear and clean paint lines, no drips on the floor.",
    long:
      "Drywall holes, cracks, and water damage patched and blended, plus interior rooms, trim, and doors prepped properly and painted cleanly.",
    icon: "brush",
    category: "Painting & Drywall Repair",
  },
  {
    key: "minor-plumbing",
    title: "Minor Plumbing",
    short: "Leaky faucets, running toilets, and fixture swaps — fixed for good.",
    long:
      "Leaky faucets, running toilets, faucet and toilet replacement, garbage disposals, and shutoff valves — the small plumbing fixes that drive you crazy.",
    icon: "wrench",
    category: "Minor Plumbing",
  },
  {
    key: "tv-mounting",
    title: "TV Mounting",
    short: "Mounted level and solid, wires hidden, ready to watch.",
    long:
      'Flat-screens mounted to the wall or over the fireplace, leveled and secure with the cords tidied up — from everyday sets up to the big 65"+ screens.',
    icon: "panel",
    category: "TV Mounting",
  },
  {
    key: "auto-maintenance",
    title: "Auto Maintenance",
    short: "Wiper blades, batteries, filters, and bulbs — routine car care in your driveway.",
    long:
      "Windshield wipers, battery swaps, cabin and engine air filters, headlight bulbs, and cloudy-lens restoration — the routine car care that needs no lift, done right in your driveway.",
    icon: "car",
    category: "Auto Maintenance",
  },
];

// Flat-rate pricing, derived from an $85/hr target labor rate with a $95
// minimum (covers the trip + first job). Drives the service menu below.
export const PRICING = {
  hourlyRate: 85,
  minimumCharge: 95,
} as const;

// Numbered "combo" packages — blocks of time for a punch list of jobs. The
// star of the menu: "I'll take the #1."
export type ServicePackage = {
  number: number;
  name: string;
  hours: number;
  price: string;
  priceCents: number;
  blurb: string;
};

export const SERVICE_PACKAGES: ServicePackage[] = [
  { number: 1, name: "The Honey-Do", hours: 2, price: "$169", priceCents: 16900, blurb: "Knock out the punch list." },
  { number: 2, name: "The Half-Day", hours: 4, price: "$329", priceCents: 32900, blurb: "Bigger projects, multiple rooms." },
  { number: 3, name: "The Full Day", hours: 8, price: "$629", priceCents: 62900, blurb: "The whole list, done in a day." },
];

// À la carte flat-rate menu, grouped by section.
//  - `id`       — stable key for cart selection + storage.
//  - `price`    — display string (a few are "from $X" where scope varies).
//  - `priceCents` — the numeric flat price for cart math (the floor for "from").
//  - `minutes`  — typical on-site time, used by the cart to total hours and
//    nudge toward a package once the list crosses ~2 hours.
export type MenuItem = {
  id: string;
  name: string;
  price: string;
  priceCents: number;
  minutes: number;
};
export type MenuSection = {
  category: ServiceCategory;
  icon: string;
  items: MenuItem[];
  // Optional caption shown under the section heading — used by Auto Maintenance
  // to flag that its small jobs sit below the $95 trip minimum and bundle best.
  note?: string;
};

export const SERVICE_MENU: MenuSection[] = [
  {
    category: "General Repairs",
    icon: "hammer",
    items: [
      { id: "door-fix", name: "Sticking or misaligned door", price: "$95", priceCents: 9500, minutes: 60 },
      { id: "recaulk", name: "Re-caulk tub, shower, or sink", price: "$125", priceCents: 12500, minutes: 90 },
      { id: "door-knob", name: "Door knob replacement", price: "$95", priceCents: 9500, minutes: 45 },
      { id: "cabinet-repair", name: "Cabinet door or drawer repair", price: "$95", priceCents: 9500, minutes: 60 },
      { id: "screen-repair", name: "Window or door screen repair", price: "$95", priceCents: 9500, minutes: 45 },
      { id: "smoke-detector", name: "Smoke & CO detector swap", price: "$95", priceCents: 9500, minutes: 30 },
      { id: "grab-bar", name: "Grab bar / safety bar install", price: "$110", priceCents: 11000, minutes: 60 },
    ],
  },
  {
    category: "Installation & Furniture Assembly",
    icon: "box",
    items: [
      { id: "ceiling-fan", name: "Ceiling fan (existing wiring)", price: "$135", priceCents: 13500, minutes: 90 },
      { id: "light-fixture", name: "Light fixture swap", price: "$110", priceCents: 11000, minutes: 60 },
      { id: "shelving", name: "Shelving / floating shelves", price: "$135", priceCents: 13500, minutes: 90 },
      { id: "furniture", name: "Furniture assembly (per item)", price: "$110", priceCents: 11000, minutes: 90 },
      { id: "hanging", name: "Mirror, art, or hardware hanging", price: "$95", priceCents: 9500, minutes: 45 },
      { id: "blinds", name: "Blinds or curtain rods (per window)", price: "from $95", priceCents: 9500, minutes: 45 },
    ],
  },
  {
    category: "Painting & Drywall Repair",
    icon: "brush",
    items: [
      { id: "patch-small", name: "Drywall patch — small hole (patch only)", price: "$135", priceCents: 13500, minutes: 90 },
      { id: "patch-paint", name: "Drywall patch + texture & paint", price: "$275", priceCents: 27500, minutes: 180 },
      { id: "room-walls", name: "Single room — walls", price: "$475", priceCents: 47500, minutes: 330 },
      { id: "trim-doors", name: "Paint — trim & doors (per room)", price: "$215", priceCents: 21500, minutes: 150 },
    ],
  },
  {
    category: "Minor Plumbing",
    icon: "wrench",
    items: [
      { id: "faucet-repair", name: "Leaky faucet / running toilet", price: "$95", priceCents: 9500, minutes: 60 },
      { id: "showerhead", name: "Showerhead swap", price: "$95", priceCents: 9500, minutes: 20 },
      { id: "faucet-replace", name: "Faucet replacement", price: "$175", priceCents: 17500, minutes: 120 },
      { id: "toilet-install", name: "Toilet install", price: "$225", priceCents: 22500, minutes: 150 },
      { id: "disposal", name: "Garbage disposal install", price: "$175", priceCents: 17500, minutes: 120 },
    ],
  },
  {
    category: "TV Mounting",
    icon: "panel",
    items: [
      { id: "tv-standard", name: 'TV up to 60" (existing outlet)', price: "$135", priceCents: 13500, minutes: 90 },
      { id: "tv-large", name: 'TV over 60" or over the fireplace', price: "$225", priceCents: 22500, minutes: 150 },
      { id: "soundbar", name: "Soundbar mount", price: "$95", priceCents: 9500, minutes: 45 },
    ],
  },
  {
    category: "Auto Maintenance",
    icon: "car",
    note: "Quick driveway jobs — bundle a few or add to any visit; the $95 trip minimum still applies.",
    items: [
      { id: "wiper-blades", name: "Windshield wiper blades", price: "$45", priceCents: 4500, minutes: 20 },
      { id: "engine-air-filter", name: "Engine air filter replacement", price: "$45", priceCents: 4500, minutes: 20 },
      { id: "cabin-air-filter", name: "Cabin air filter replacement", price: "$55", priceCents: 5500, minutes: 30 },
      { id: "auto-bulb", name: "Headlight / taillight bulb replacement", price: "$45", priceCents: 4500, minutes: 30 },
      { id: "car-battery", name: "Car battery replacement", price: "$75", priceCents: 7500, minutes: 30 },
      { id: "headlight-restore", name: "Headlight restoration (cloudy lenses)", price: "$75", priceCents: 7500, minutes: 45 },
    ],
  },
];

// Package time blocks in minutes, for the cart's "you've got enough for the #1"
// nudge. Keyed by package number.
export const PACKAGE_MINUTES: Record<number, number> = { 1: 120, 2: 240, 3: 480 };

export const TRUST_SIGNALS = [
  { icon: "shield", label: "Fully Insured" },
  { icon: "hammer", label: "40+ Years Experience" },
  { icon: "home", label: "Locally Owned" },
  { icon: "star", label: "5-Star Reviews" },
  { icon: "tag", label: "Free Estimates" },
];

export const VALUES = [
  {
    title: "Integrity",
    body:
      "We tell you the truth about what a job needs — even when it means recommending less work, not more.",
  },
  {
    title: "Craftsmanship",
    body:
      "Forty years of experience means we know what 'done right' looks like, and we don't cut corners to save an hour.",
  },
  {
    title: "Reliability",
    body:
      "If we say we'll be there at 9, we're there at 9. If something comes up, you hear it from us — not from a no-show.",
  },
  {
    title: "Fair Pricing",
    body:
      "Free estimates in writing. No surprise charges, no upsells, no 'while we're in there' add-ons.",
  },
];

export const TESTIMONIALS = [
  {
    quote:
      "David showed up exactly when he said he would, fixed three things on our list that I'd been putting off for months, and left the place cleaner than he found it. Finally — a handyman I can trust.",
    name: "Sarah M.",
    location: "Garner, NC",
  },
  {
    quote:
      "We had a rotted section of deck and a wobbly railing that was scaring the grandkids. David replaced the boards, rebuilt the rail, and the whole thing feels solid as new. Fair price, no drama.",
    name: "Tom & Linda R.",
    location: "Clayton, NC",
  },
  {
    quote:
      "Hired Forge for a full day of odd jobs — ceiling fan, new faucet, patched a hole in the drywall, hung some shelves. Quoted me an honest estimate and stuck to it. Already have him booked again.",
    name: "Marcus J.",
    location: "Raleigh, NC",
  },
  {
    quote:
      "I don't leave reviews usually, but David earned this one. Knew exactly what he was doing, explained everything, and treated my home like it was his own.",
    name: "Priya K.",
    location: "Garner, NC",
  },
];

export const REFERRAL_SOURCES = [
  "Nextdoor",
  "Google",
  "Facebook",
  "Referral",
  "Other",
];

// Service categories — locked 10-option taxonomy from Amendment §21.1.
// Internal code is stored in the sheet; label is shown to customers.
export type ServiceCategoryCode =
  | "mounting"
  | "plumbing"
  | "electrical"
  | "drywall_paint"
  | "doors_windows"
  | "carpentry"
  | "exterior"
  | "maintenance"
  | "multiple"
  | "other";

export const SERVICE_CATEGORIES: {
  code: ServiceCategoryCode;
  label: string;
}[] = [
  { code: "mounting", label: "Mounting & assembly (TVs, shelves, furniture)" },
  { code: "plumbing", label: "Plumbing repair or fixture install" },
  { code: "electrical", label: "Electrical repair or fixture install" },
  { code: "drywall_paint", label: "Drywall, painting, or trim" },
  { code: "doors_windows", label: "Doors, windows, or hardware" },
  { code: "carpentry", label: "Carpentry, deck, or fence work" },
  { code: "exterior", label: "Outdoor or exterior work" },
  { code: "maintenance", label: "General repair or maintenance" },
];

// Codes selectable as the only choice (single-select) when user says
// they need "multiple things" or "not sure." These are NOT in the
// SERVICE_CATEGORIES list because they shouldn't appear as checkbox
// options — they're auto-set based on what the customer picks.
export const SERVICE_CATEGORY_CODES = SERVICE_CATEGORIES.map((s) => s.code);

export const SERVICE_LABEL_BY_CODE: Record<ServiceCategoryCode, string> = {
  ...Object.fromEntries(
    SERVICE_CATEGORIES.map((s) => [s.code, s.label]),
  ),
  multiple: "Multiple things (a punch-list)",
  other: "Not sure / something else",
} as Record<ServiceCategoryCode, string>;

export const PROPERTY_TYPES = [
  { code: "residential", label: "Residential (my home)" },
  { code: "rental", label: "Rental I own" },
  { code: "commercial", label: "Commercial property" },
  { code: "hoa", label: "HOA common area" },
  { code: "other", label: "Other" },
] as const;

export type PropertyTypeCode = (typeof PROPERTY_TYPES)[number]["code"];

export const URGENCY_OPTIONS = [
  { code: "asap", label: "As soon as possible" },
  { code: "two_weeks", label: "Within 2 weeks" },
  { code: "month", label: "Within a month" },
  { code: "flexible", label: "Flexible — anytime" },
] as const;

export type UrgencyCode = (typeof URGENCY_OPTIONS)[number]["code"];

export const CONTACT_TIMES = [
  { code: "any", label: "Any time" },
  { code: "morning", label: "Morning (8a–12p)" },
  { code: "afternoon", label: "Afternoon (12p–5p)" },
  { code: "evening", label: "Evening (5p–8p)" },
] as const;

export type ContactTimeCode = (typeof CONTACT_TIMES)[number]["code"];

export const CONTACT_METHODS = [
  { code: "any", label: "Any" },
  { code: "phone", label: "Phone call" },
  { code: "text", label: "Text message" },
  { code: "email", label: "Email" },
] as const;

export type ContactMethodCode = (typeof CONTACT_METHODS)[number]["code"];
