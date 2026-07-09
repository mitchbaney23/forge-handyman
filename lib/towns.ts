// The 8 towns inside the 20-mile service radius (see SERVICE_AREA_RADIUS_MILES
// / lib/geocoding.ts for the enforcement; this file is the marketing/SEO view).
// Listed by name because each town is a local-search keyword — surfaced on the
// single /service-area page and in the layout's areaServed schema. Lines are
// deliberately plain geographic facts, not marketing color.

export interface Town {
  slug: string;
  name: string;
  line: string;
}

export const TOWNS: Town[] = [
  { slug: "garner", name: "Garner", line: "Our home base." },
  {
    slug: "raleigh",
    name: "Raleigh",
    line: "South and southeast Raleigh fall inside our radius.",
  },
  { slug: "cary", name: "Cary", line: "West along US-1 and US-64." },
  {
    slug: "clayton",
    name: "Clayton",
    line: "The Johnston County side, just down US-70.",
  },
  { slug: "knightdale", name: "Knightdale", line: "East Wake County." },
  { slug: "wendell", name: "Wendell", line: "East Wake, past Knightdale." },
  { slug: "holly-springs", name: "Holly Springs", line: "Southwest Wake County." },
  {
    slug: "fuquay-varina",
    name: "Fuquay-Varina",
    line: "Southern Wake, at the edge of our ring.",
  },
];
