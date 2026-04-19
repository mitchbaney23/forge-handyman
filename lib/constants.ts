export const BUSINESS = {
  name: "Forge Handyman Service",
  tagline: "Honest Work. Built to Last.",
  phone: "(828) 551-9690",
  phoneHref: "tel:+18285519690",
  email: "david@forgehandyman.com",
  emailHref: "mailto:david@forgehandyman.com",
  owner: "David Baney",
  manager: "Mitch Baney",
  city: "Garner",
  region: "NC",
  country: "US",
  serviceAreaLine: "Serving Garner, Clayton & South Raleigh, NC",
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
  | "carpentry"
  | "painting"
  | "deck-fence"
  | "fixtures"
  | "assembly"
  | "pressure-washing"
  | "drywall";

export type Service = {
  key: ServiceKey;
  title: string;
  short: string;
  long: string;
  icon: string;
  category: ServiceCategory;
};

export type ServiceCategory =
  | "General Repairs & Maintenance"
  | "Carpentry & Woodwork"
  | "Painting"
  | "Assembly & Installation"
  | "Outdoor & Seasonal";

export const SERVICES: Service[] = [
  {
    key: "general-repairs",
    title: "General Repairs",
    short: "Leaky faucets, sticky doors, loose railings — all the nagging fixes.",
    long:
      "From leaky faucets and running toilets to sticky doors and loose railings, we tackle the growing list of small repairs most homeowners never get to. One visit, one invoice, done right.",
    icon: "wrench",
    category: "General Repairs & Maintenance",
  },
  {
    key: "carpentry",
    title: "Carpentry & Woodwork",
    short: "Trim, shelving, custom builds, and honest old-school carpentry.",
    long:
      "Trim work, crown molding, custom shelving, door and window repairs, and small custom builds. Four decades of hands-on carpentry means tight miters and square corners.",
    icon: "saw",
    category: "Carpentry & Woodwork",
  },
  {
    key: "painting",
    title: "Interior & Exterior Painting",
    short: "Clean lines, proper prep, no drips on the floor.",
    long:
      "Interior rooms, trim, doors, and smaller exterior projects. We prep properly, protect your floors and furniture, and leave the job site cleaner than we found it.",
    icon: "brush",
    category: "Painting",
  },
  {
    key: "deck-fence",
    title: "Deck & Fence Work",
    short: "Board replacement, railings, repairs, and refinishing.",
    long:
      "Replace rotted deck boards, fix loose railings, repair fence sections, and refinish weathered wood. We build things that hold up to Carolina weather.",
    icon: "fence",
    category: "Outdoor & Seasonal",
  },
  {
    key: "fixtures",
    title: "Fixture Installation",
    short: "Ceiling fans, light fixtures, faucets, shelving, hardware.",
    long:
      "Ceiling fans, light fixtures, faucets, cabinet hardware, wall-mounted shelving, mirrors, TVs, and more. Installed level, solid, and tested before we leave.",
    icon: "lightbulb",
    category: "Assembly & Installation",
  },
  {
    key: "assembly",
    title: "Furniture Assembly",
    short: "Flat-pack furniture, play sets, outdoor pieces — skip the headache.",
    long:
      "Let us handle the flat-pack furniture, play sets, outdoor pieces, and whatever else is still in the box in your garage. Assembled correctly, fully tested, packaging hauled away.",
    icon: "box",
    category: "Assembly & Installation",
  },
  {
    key: "pressure-washing",
    title: "Pressure Washing",
    short: "Driveways, siding, decks, walkways — restored in a day.",
    long:
      "Driveways, sidewalks, siding, decks, fences, and outdoor furniture. The right pressure and technique for each surface — no stripped paint, no gouged wood.",
    icon: "spray",
    category: "Outdoor & Seasonal",
  },
  {
    key: "drywall",
    title: "Drywall Repair",
    short: "Holes, cracks, water damage — patched and painted.",
    long:
      "Doorknob holes, nail pops, stress cracks, water-damaged patches. We cut it clean, patch it flat, and blend the texture so the repair disappears.",
    icon: "panel",
    category: "General Repairs & Maintenance",
  },
];

export const TRUST_SIGNALS = [
  { icon: "shield", label: "Licensed & Insured" },
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

export const SERVICE_OPTIONS = [
  "General Repair",
  "Carpentry",
  "Painting",
  "Assembly / Installation",
  "Deck / Fence",
  "Pressure Washing",
  "Drywall",
  "Other",
];
