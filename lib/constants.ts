export const BUSINESS = {
  name: "Forge Handyman Service",
  tagline: "Honest Work. Built to Last.",
  phone: "(919) 275-2823",
  phoneHref: "tel:+19192752823",
  // The public-facing address for the whole site — header, footer, contact
  // page, privacy/terms, and the JSON-LD. Kept as one constant so it can never
  // drift between surfaces. Matches BUSINESS_EMAIL, the mailbox the site also
  // sends mail as, so replies land where notifications do.
  email: "admin@forgehandyman.com",
  emailHref: "mailto:admin@forgehandyman.com",
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

// Flat-rate pricing. The $95 minimum is the cheapest full-price item — the
// first-item-full-price rule enforces it naturally (no separate trip fee).
export const PRICING = {
  minimumCharge: 95,
} as const;

// Pricing stance: Forge is a new business — posted prices must sit at or
// below local competitors', never above, and the flat-rate rework must not
// cost any customer more than the old menu did (Mitch, 2026-08-20): bundle
// stickers stay at the old $169 / $329-or-less / from $629. `minutes` on
// menu items is the internal time estimate that drives scheduling; actual-
// time tracking and re-tuning is a later phase, so keep those fields even
// though nothing customer-facing reads them.

// The add-on pricing engine's knobs. Every item under $200 gets an add-on
// price: HALF the full price (Mitch, 2026-08-20 — "add another" should be
// half, not ~80%), rounded DOWN to the nearest $5, floor $45. Items at $200+
// are project-scale (the trip is a negligible fraction) — they always charge
// full price.
export const ADD_ON_RATE = 0.5;
export const ADD_ON_FLOOR_CENTS = 4500;
export const ADD_ON_MAX_FULL_CENTS = 20000;

// Package eligibility: a "small fix" is a menu item with a full price of $135
// or less (add-on-only sections excluded — see `addOnOnly` below).
export const SMALL_FIX_MAX_CENTS = 13500;

// Numbered "combo" packages — flat item-count bundles for a punch list of
// jobs. The star of the menu: "I'll take the #1." Priced in items, never
// hours: no hour count may ever render customer-facing.
export type ServicePackage = {
  number: number;
  name: string;
  // How many small fixes the bundle covers ("up to N" — a customer with
  // fewer can still take it). null = #3, the quote-first "whole list"
  // product (no fixed count — quoted flat from photos).
  itemCount: number | null;
  // INTERNAL scheduling duration. Feeds the slot picker only — never render
  // it to the customer.
  estimatedMinutes: number;
  price: string;
  priceCents: number;
  scope: string;
  blurb: string;
  // Quote-first products skip the slot picker: the customer sends the list +
  // photos and gets one flat number back before anything is scheduled.
  quoteFirst?: boolean;
};

export const SERVICE_PACKAGES: ServicePackage[] = [
  {
    number: 1,
    name: "The Honey-Do",
    itemCount: 3,
    estimatedMinutes: 150,
    price: "$169",
    priceCents: 16900,
    scope: "Up to 3 from the Small Fixes list",
    blurb: "Three nagging fixes, one visit, one price.",
  },
  {
    number: 2,
    name: "The Punch List",
    itemCount: 6,
    estimatedMinutes: 300,
    price: "$299",
    priceCents: 29900,
    scope: "Up to 6 from the Small Fixes list",
    blurb: "The whole sticky-note collection, handled.",
  },
  {
    number: 3,
    name: "The Whole List",
    itemCount: null,
    estimatedMinutes: 480,
    price: "from $629",
    priceCents: 62900,
    scope: "Your full punch list, quoted flat from your photos",
    blurb: "Send the list and the photos — we'll send one number.",
    quoteFirst: true,
  },
];

// À la carte flat-rate menu, grouped by section.
//  - `id`       — stable key for cart selection + storage.
//  - `price`    — display string (a few are "from $X" where scope varies).
//  - `priceCents` — the numeric flat price for cart math (the floor for "from").
//  - `addOnCents` / `addOnPrice` — the add-on price for every unit after the
//    cart's most expensive one (half the full price, $5-rounded-down, floor
//    $45). null on $200+ items — they always charge full price.
//  - `packageEligible` — counts toward the item-count bundles ("small fixes":
//    full price ≤ $135, add-on-only sections excluded).
//  - `minutes`  — internal time estimate; drives scheduling and future
//    calibration — never render as pricing.
export type MenuItem = {
  id: string;
  name: string;
  price: string;
  priceCents: number;
  addOnCents: number | null;
  addOnPrice: string | null;
  packageEligible: boolean;
  minutes: number;
};
export type MenuSection = {
  category: ServiceCategory;
  icon: string;
  items: MenuItem[];
  // Optional caption shown under the section heading — used by Auto Maintenance
  // to explain that its small jobs ride along with other work.
  note?: string;
  // Add-on-only sections (Auto Maintenance): items are bookable only alongside
  // another service, or ≥2 together totaling the $95 minimum. Their posted
  // prices already behave like add-on prices (addOnCents = priceCents) and
  // they don't count toward package eligibility.
  addOnOnly?: boolean;
};

// The raw menu before add-on pricing is derived. Kept separate so the add-on
// formula stays one function instead of a second hand-maintained price list.
type RawMenuItem = Omit<MenuItem, "addOnCents" | "addOnPrice" | "packageEligible">;
type RawMenuSection = Omit<MenuSection, "items"> & { items: RawMenuItem[] };

// add-on = half the full price, rounded down to the nearest $5, floor $45.
// null for $200+ items (no add-on price — always full).
function deriveAddOnCents(priceCents: number): number | null {
  if (priceCents >= ADD_ON_MAX_FULL_CENTS) return null;
  const discounted = Math.floor((priceCents * ADD_ON_RATE) / 500) * 500;
  return Math.max(discounted, ADD_ON_FLOOR_CENTS);
}

function withDerivedPricing(section: RawMenuSection): MenuSection {
  return {
    ...section,
    items: section.items.map((item) => {
      // Add-on-only items are already priced as add-ons — no further discount.
      const addOnCents = section.addOnOnly
        ? item.priceCents
        : deriveAddOnCents(item.priceCents);
      return {
        ...item,
        addOnCents,
        addOnPrice: addOnCents != null ? `$${addOnCents / 100}` : null,
        packageEligible:
          !section.addOnOnly && item.priceCents <= SMALL_FIX_MAX_CENTS,
      };
    }),
  };
}

const RAW_SERVICE_MENU: RawMenuSection[] = [
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
    addOnOnly: true,
    note: "These ride along with any visit — add them to whatever else David's already fixing, or book two or more together ($95 minimum).",
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

export const SERVICE_MENU: MenuSection[] = RAW_SERVICE_MENU.map(withDerivedPricing);

// The menu's customer-facing tiers. "Small Fixes" is EXACTLY the set of
// package-eligible items, so the menu heading and the bundle scopes ("any 3
// from the Small Fixes list") stay correlated by construction — regrouping
// here, not hand-curating, means an item can never drift between the list
// and the bundles' definition. Generic over the section shape so the
// family-priced menu regroups the same way.
export function groupMenuBySize<
  I extends { packageEligible: boolean },
  S extends { items: I[]; addOnOnly?: boolean },
>(menu: S[]): { small: S[]; big: S[]; addOn: S[] } {
  const small: S[] = [];
  const big: S[] = [];
  const addOn: S[] = [];
  for (const section of menu) {
    if (section.addOnOnly) {
      addOn.push(section);
      continue;
    }
    const smallItems = section.items.filter((i) => i.packageEligible);
    const bigItems = section.items.filter((i) => !i.packageEligible);
    if (smallItems.length > 0) small.push({ ...section, items: smallItems });
    if (bigItems.length > 0) big.push({ ...section, items: bigItems });
  }
  return { small, big, addOn };
}

// Tier headings + explainers, shared by /services, /family, and the booking
// form so the wording never forks.
export const MENU_TIERS = {
  small: {
    title: "Small Fixes",
    note: "Everything in this list counts toward the #1 and #2 — first fix at full price, each additional one at its add-on price.",
  },
  big: {
    title: "Big Fixes",
    note: "Project-scale work, priced flat per job. Got a whole list? That's the #3 — send photos, get one number back.",
  },
} as const;

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
