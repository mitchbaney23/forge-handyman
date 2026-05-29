import type { ServiceCategoryCode } from "@/lib/constants";

export interface NudgeTemplate {
  subject: string;
  preheader: string;
  body: string;
}

// Per-category seasonal nudge copy. Pick based on the customer's prior
// service categories. Body is plain text; the admin UI can edit before
// sending. Tone: friendly, low-pressure, time-anchored to the season.

function genericTemplate(firstName: string): NudgeTemplate {
  return {
    subject: "Anything around the house need a hand this season?",
    preheader: "A quick check-in from David at Forge Handyman.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. It's been a while since we worked together — figured I'd check in.",
      "",
      "If there's anything around the house you've been meaning to handle (a punch list of small repairs, something seasonal, anything weird), happy to swing by and take a look. Free estimate either way.",
      "",
      "Just reply to this email if you'd like to chat.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  };
}

const TEMPLATES: Partial<Record<ServiceCategoryCode, (name: string) => NudgeTemplate>> = {
  mounting: (firstName) => ({
    subject: "Anything new to hang, mount, or assemble?",
    preheader: "TVs, shelves, or that boxed furniture you're tired of looking at.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. It's been a bit — figured I'd check in.",
      "",
      "If you've picked up a new TV, art, mirror, shelving, or any flat-pack furniture you'd rather not assemble yourself, happy to swing by and knock it all out in one visit. Always free to come quote.",
      "",
      "Just reply if you'd like to chat.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  }),
  plumbing: (firstName) => ({
    subject: "Plumbing fixtures holding up okay?",
    preheader: "Faucet drips, slow drains, fixture upgrades — small jobs we knock out fast.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. Quick check-in.",
      "",
      "If anything plumbing-related has come up since we last worked together — running toilet, dripping faucet, garbage disposal, fixture you've been meaning to swap out — happy to come take a look. Most small plumbing jobs we knock out in under an hour.",
      "",
      "Just reply if you'd like an estimate.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  }),
  electrical: (firstName) => ({
    subject: "Light fixtures or fan upgrades on the list?",
    preheader: "Ceiling fans, outlets, switches, fixtures — quick wins.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. Hope all's well.",
      "",
      "If you've been thinking about swapping out a light fixture, installing a ceiling fan, or addressing any switches or outlets, those are quick wins. Happy to come quote anytime.",
      "",
      "Just reply if you'd like to chat.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  }),
  drywall_paint: (firstName) => ({
    subject: "Walls and trim holding up okay?",
    preheader: "Touch-up paint, drywall patches, trim refresh — easy seasonal projects.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. Quick check-in.",
      "",
      "Walls and trim take a beating over a year — kid-height scuffs, settled drywall cracks, faded baseboards. If anything's bugging you, happy to come quote. Most rooms we can knock out in a day or two.",
      "",
      "Just reply if you'd like to talk it through.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  }),
  doors_windows: (firstName) => ({
    subject: "Doors, windows, hardware — anything sticking?",
    preheader: "Squeaky hinges, sticky doors, old hardware — small jobs we get to fast.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. Hope all's well.",
      "",
      "Doors and windows tend to swell, settle, and start sticking through the seasons. If anything's bugging you — a door that won't latch, a window that won't open, hardware that needs swapping — happy to come quote.",
      "",
      "Just reply if you'd like to chat.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  }),
  carpentry: (firstName) => ({
    subject: "Deck or trim need a hand before the season changes?",
    preheader: "Deck boards, railings, trim, custom builds — anything wood.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. Checking in.",
      "",
      "If you've got any deck repairs, fence sections, trim work, or small custom carpentry on your list, this is a good time of year to get it done. Happy to come quote anytime.",
      "",
      "Just reply if you'd like to talk it through.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  }),
  exterior: (firstName) => ({
    subject: "Outdoor projects on the docket?",
    preheader: "Pressure washing, deck refinish, gutters, exterior touch-ups.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. Quick check-in.",
      "",
      "Outside of the house tends to get neglected until something's clearly off. If there's any pressure washing, deck or fence refinish, gutter work, or exterior touch-ups on your list, happy to come quote.",
      "",
      "Just reply if you'd like to chat.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  }),
  maintenance: (firstName) => ({
    subject: "Anything around the house need a hand this season?",
    preheader: "Routine repairs, punch list, small projects we knock out fast.",
    body: [
      `Hi ${firstName},`,
      "",
      "David here at Forge. It's been a while — figured I'd check in.",
      "",
      "If you've got a running list of small house things — repairs, swaps, touch-ups, anything you've been putting off — I'd love to come knock through them in one visit. Free estimate either way.",
      "",
      "Just reply if you'd like to chat.",
      "",
      "— David",
      "Forge Handyman Service",
    ].join("\n"),
  }),
};

export function pickTemplate(
  customerName: string,
  priorCategories: ServiceCategoryCode[],
): NudgeTemplate {
  const firstName = (customerName || "there").split(/\s+/)[0] || "there";
  // First category they used last time anchors the nudge.
  const code = priorCategories[0];
  if (code && TEMPLATES[code]) return TEMPLATES[code]!(firstName);
  return genericTemplate(firstName);
}
