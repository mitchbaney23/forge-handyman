// The 8 towns inside the 20-mile service radius (see SERVICE_AREA_RADIUS_MILES
// / lib/geocoding.ts for the enforcement; this file is the marketing/SEO view).
// Each town gets a static landing page at /handyman/[slug] — every name is a
// local-SEO keyword, which is why we list towns instead of "greater Raleigh".

export interface Town {
  slug: string;
  name: string;
  // One-line locator fact that keeps the copy honest and non-templated.
  headline: string;
  blurb: string;
}

export const TOWNS: Town[] = [
  {
    slug: "garner",
    name: "Garner",
    headline: "Our home base — David lives and works right here.",
    blurb:
      "Forge Handyman Service is based in Garner, so you're getting a neighbor, not a dispatch center. From White Oak to Lake Benson, we handle the repair lists Garner homeowners have been putting off — with real open slots you can book online.",
  },
  {
    slug: "raleigh",
    name: "Raleigh",
    headline: "South and Southeast Raleigh are minutes from our shop.",
    blurb:
      "We take on Raleigh jobs inside the 20-mile ring around Garner — which covers most of the city south of the beltline. Older Raleigh homes mean settled doors, tired caulk, and drywall dings; that's exactly the work we do all day.",
  },
  {
    slug: "cary",
    name: "Cary",
    headline: "Straight up US-1 — an easy run for a day of fixes.",
    blurb:
      "Cary homeowners usually call us with a list: fixture swaps, TV mounting, shelf and closet installs, the door that never latched right. We price from a flat-rate menu, so you know the number before David's truck leaves Garner.",
  },
  {
    slug: "clayton",
    name: "Clayton",
    headline: "Just down US-70 — Johnston County is home turf.",
    blurb:
      "From Flowers Plantation to downtown Clayton, we've patched, mounted, sealed, and assembled all over town. Newer builds here still need punch-list help the builder never finished — that's a Forge specialty.",
  },
  {
    slug: "knightdale",
    name: "Knightdale",
    headline: "East Wake's growth means new homes with growing lists.",
    blurb:
      "Knightdale's newer neighborhoods keep us busy with ceiling fans, blinds, grab bars, and wall mounting. One trip, several jobs done — that's the cheapest way to use a handyman, and our packages are built around it.",
  },
  {
    slug: "wendell",
    name: "Wendell",
    headline: "Wendell Falls to downtown — we cover all of it.",
    blurb:
      "We serve Wendell on the same flat-rate menu as everywhere else — no travel surcharge inside our 20-mile radius. Screen repairs, door hardware, paint touch-ups, smoke-detector swaps: send the list and we'll quote it straight.",
  },
  {
    slug: "holly-springs",
    name: "Holly Springs",
    headline: "Southwest Wake, same flat rates.",
    blurb:
      "Holly Springs homeowners find us when the big remodelers won't call back about small jobs. Small jobs are our whole business — drywall patches, fixture swaps, TV mounting, and the rest of the Saturday list.",
  },
  {
    slug: "fuquay-varina",
    name: "Fuquay-Varina",
    headline: "Both downtowns, one honest handyman.",
    blurb:
      "Fuquay-Varina sits right at the edge of our 20-mile ring, and we treat it like home turf: written estimates, flat-rate pricing, and a craftsman with 40 years of repairs behind him showing up when he said he would.",
  },
];

export function townBySlug(slug: string): Town | undefined {
  return TOWNS.find((t) => t.slug === slug);
}
