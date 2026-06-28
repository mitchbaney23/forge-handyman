import {
  SERVICE_MENU,
  SERVICE_PACKAGES,
  type MenuItem,
  type MenuSection,
  type ServicePackage,
} from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// Forge Family pricing — friends & family rates.
//
// THE WHOLE THING HAS ONE KNOB: `discountRate`. Every family price below is
// DERIVED from the posted base prices in lib/constants.ts — there is no second
// price list to maintain. Change the rate and the entire family menu (packages,
// à-la-carte, and the auto-maintenance items) moves with it, staying in sync
// with the public /services menu automatically.
// ─────────────────────────────────────────────────────────────────────────────

export const FORGE_FAMILY = {
  // 30% off every posted price — a launch-window rate for early reviewers.
  discountRate: 0.3,
  // The ask in return for the deal (shown on the page).
  ask: "an honest review once the work's done, plus a few minutes of straight feedback on how the whole thing went — from booking to cleanup",
} as const;

// "30%" for headlines.
export const FAMILY_DISCOUNT_LABEL = `${Math.round(FORGE_FAMILY.discountRate * 100)}%`;

// Round a discounted amount DOWN to the nearest $5 (500 cents). Rounding down
// means a family price is always at least the advertised discount — rounding
// never eats into the deal — and always lands on a clean menu number.
export function familyCents(baseCents: number): number {
  const discounted = baseCents * (1 - FORGE_FAMILY.discountRate);
  return Math.floor(discounted / 500) * 500;
}

// Whole-dollar display ($65, not $65.00), preserving a leading "from " when the
// base price is scope-dependent (e.g. "from $95").
function familyDisplay(baseDisplay: string, cents: number): string {
  const prefix = baseDisplay.trimStart().toLowerCase().startsWith("from ") ? "from " : "";
  return `${prefix}$${cents / 100}`;
}

// Public helper: the family price as a display string, derived from a base
// display string + base cents. Preserves a leading "from ". Used by the cart +
// booking form so the discount shown on /family follows the friend into
// checkout (single source of truth — same rounding as the /family page).
export function familyPriceLabel(baseDisplay: string, baseCents: number): string {
  return familyDisplay(baseDisplay, familyCents(baseCents));
}

// A menu item / package carries its family price in the usual `price` /
// `priceCents` fields, plus the original (`basePrice` / `baseCents`) so the page
// can show the strike-through and the savings.
export type FamilyMenuItem = MenuItem & {
  basePrice: string;
  baseCents: number;
};

export type FamilyMenuSection = Omit<MenuSection, "items"> & {
  items: FamilyMenuItem[];
};

export type FamilyPackage = ServicePackage & {
  basePrice: string;
  baseCents: number;
};

export const FAMILY_MENU: FamilyMenuSection[] = SERVICE_MENU.map((section) => ({
  ...section,
  items: section.items.map((item) => {
    const cents = familyCents(item.priceCents);
    return {
      ...item,
      basePrice: item.price,
      baseCents: item.priceCents,
      price: familyDisplay(item.price, cents),
      priceCents: cents,
    };
  }),
}));

export const FAMILY_PACKAGES: FamilyPackage[] = SERVICE_PACKAGES.map((pkg) => {
  const cents = familyCents(pkg.priceCents);
  return {
    ...pkg,
    basePrice: pkg.price,
    baseCents: pkg.priceCents,
    price: `$${cents / 100}`,
    priceCents: cents,
  };
});
