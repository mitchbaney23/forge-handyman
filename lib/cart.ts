import {
  PRICING,
  SERVICE_MENU,
  SERVICE_PACKAGES,
  type MenuItem,
  type ServiceCategory,
  type ServiceCategoryCode,
  type ServicePackage,
} from '@/lib/constants'
import { familyCents, familyPriceLabel } from '@/lib/family-pricing'

// THE CART PAYLOAD CONTRACT — the form, the API, and the tests all agree on
// this exact shape. The client sends `cart: Cart` (it no longer sends
// serviceCategories; the server derives them).
export type CartSelection = {
  id: string // matches a SERVICE_MENU item id
  qty: number
}

export type Cart = {
  items: CartSelection[]
  packageNumber: number | null // 1 | 2 | 3 or null
}

// A resolved à-la-carte line: the menu item, its qty, and the section it came
// from (used for back-compat category derivation).
export type ResolvedCartLine = {
  id: string
  name: string
  qty: number
  price: string
  priceCents: number
  addOnCents: number | null
  addOnPrice: string | null
  packageEligible: boolean
  addOnOnly: boolean
  minutes: number
  category: ServiceCategory
}

// Map of menu item id -> { item, category, addOnOnly } for O(1) lookup. Built once.
const MENU_INDEX: Map<
  string,
  { item: MenuItem; category: ServiceCategory; addOnOnly: boolean }
> = new Map(
  SERVICE_MENU.flatMap((section) =>
    section.items.map(
      (item) =>
        [
          item.id,
          { item, category: section.category, addOnOnly: section.addOnOnly ?? false },
        ] as const,
    ),
  ),
)

// Section -> back-compat SERVICE_CATEGORIES code. TV Mounting and Installation
// & Furniture Assembly both map to 'mounting'.
const CATEGORY_CODE_BY_SECTION: Record<ServiceCategory, ServiceCategoryCode> = {
  'General Repairs': 'maintenance',
  'Installation & Furniture Assembly': 'mounting',
  'Painting & Drywall Repair': 'drywall_paint',
  'Minor Plumbing': 'plumbing',
  'TV Mounting': 'mounting',
  'Auto Maintenance': 'maintenance',
}

const PACKAGE_BY_NUMBER: Map<number, ServicePackage> = new Map(
  SERVICE_PACKAGES.map((p) => [p.number, p]),
)

// The package nudge starts at 2 items: bundles are "up to N", so a 2-fix
// list already fits the #1 (Mitch, 2026-08-20 — the 2-fixture customer
// should see the #1 offer just like the old 2-hour block).
const MIN_BUNDLE_ITEMS = 2

// Clamp a qty into 1..10, defaulting to 1 for missing/invalid values.
function clampQty(qty: number | undefined): number {
  if (typeof qty !== 'number' || !Number.isFinite(qty)) return 1
  const n = Math.floor(qty)
  if (n < 1) return 1
  if (n > 10) return 10
  return n
}

function resolvePackage(packageNumber: number | null): ServicePackage | null {
  if (packageNumber == null) return null
  return PACKAGE_BY_NUMBER.get(packageNumber) ?? null
}

// Resolve a raw cart into known menu lines (unknown ids dropped) + the package.
export function resolveCart(cart: Cart): {
  lines: ResolvedCartLine[]
  pkg: ServicePackage | null
} {
  const lines: ResolvedCartLine[] = []
  for (const selection of cart.items) {
    const found = MENU_INDEX.get(selection.id)
    if (!found) continue // ignore unknown ids
    const { item, category, addOnOnly } = found
    lines.push({
      id: item.id,
      name: item.name,
      qty: clampQty(selection.qty),
      price: item.price,
      priceCents: item.priceCents,
      addOnCents: item.addOnCents,
      addOnPrice: item.addOnPrice,
      packageEligible: item.packageEligible,
      addOnOnly,
      minutes: item.minutes,
      category,
    })
  }
  return { lines, pkg: resolvePackage(cart.packageNumber) }
}

// A line's add-on unit price — falls back to full price when the item has no
// add-on price ($200+ project-scale items never discount).
function addOnOrFullCents(line: ResolvedCartLine): number {
  return line.addOnCents ?? line.priceCents
}

// À-la-carte totals only — does NOT include the package.
//
// THE ENGINE: the single most expensive line in the cart charges full price
// for one unit (that unit carries the trip); every other unit — including
// qty > 1 of the same item — charges its add-on price. Order-independent, so
// it can't be gamed by reordering the cart. $200+ items have no add-on price:
// they charge full price on every unit AND (being the most expensive line)
// push everything else in the cart to add-on pricing.
//
// Pass { family: true } to total at Forge Family rates: each unit price is
// discounted + $5-rounded-down individually (exactly as the /family page
// shows) BEFORE summing, so the booking estimate stays in sync with the
// promise — one knob, one price list.
//
// Returns both the engine subtotal and `naiveSubtotalCents` (every unit at
// full price) so the UI can show "you save $X vs. booking separately."
export function cartTotals(
  cart: Cart,
  opts?: { family?: boolean },
): {
  itemCount: number
  subtotalCents: number
  naiveSubtotalCents: number
  minutes: number
} {
  const family = opts?.family ?? false
  const unit = (cents: number) => (family ? familyCents(cents) : cents)
  const { lines } = resolveCart(cart)

  let itemCount = 0
  let minutes = 0
  let naiveSubtotalCents = 0
  let subtotalCents = 0
  let anchor: ResolvedCartLine | null = null
  for (const line of lines) {
    itemCount += line.qty
    minutes += line.minutes * line.qty
    naiveSubtotalCents += unit(line.priceCents) * line.qty
    subtotalCents += unit(addOnOrFullCents(line)) * line.qty
    if (!anchor || line.priceCents > anchor.priceCents) anchor = line
  }
  // Promote exactly one unit of the most expensive line to full price.
  if (anchor) {
    subtotalCents += unit(anchor.priceCents) - unit(addOnOrFullCents(anchor))
  }
  return { itemCount, subtotalCents, naiveSubtotalCents, minutes }
}

// The job duration in minutes implied by a cart: the package's internal
// scheduling estimate when a package is chosen, else the summed à-la-carte
// minutes. Returns 0 for an empty cart AND for a quote-first package (#3) —
// those have no bookable duration, so the caller routes them to the
// photo/callback flow rather than the slot picker.
export function cartJobMinutes(cart: Cart): number {
  const pkg = resolvePackage(cart.packageNumber)
  if (pkg) {
    return pkg.quoteFirst ? 0 : pkg.estimatedMinutes
  }
  return cartTotals(cart).minutes
}

// The package nudge. When a cart holds ≥2 package-eligible small fixes (and no
// package, and nothing a bundle couldn't cover — accepting the nudge swaps the
// whole list, so a cart with any non-eligible line gets no nudge rather than
// silently dropping an item), suggest the cheapest bundle that covers the
// count. A bundle qualifies when it covers every fix AND either beats the
// engine subtotal outright or has headroom for more fixes (the upsell case:
// "the #2 covers up to 6 — room for 2 more"). The engine subtotal is already
// fair, so this is a convenience suggestion, never a rescue — and never an
// auto-swap.
export function suggestPackage(cart: Cart): ServicePackage | null {
  if (cart.packageNumber != null) return null
  const { lines } = resolveCart(cart)
  if (lines.length === 0) return null
  if (lines.some((line) => !line.packageEligible)) return null

  const count = lines.reduce((n, line) => n + line.qty, 0)
  if (count < MIN_BUNDLE_ITEMS) return null

  const { subtotalCents } = cartTotals(cart)
  const candidates = SERVICE_PACKAGES.filter(
    (pkg) =>
      pkg.itemCount != null &&
      pkg.itemCount >= count &&
      (pkg.priceCents <= subtotalCents || pkg.itemCount > count),
  )
  if (candidates.length === 0) return null

  // Cheapest qualifying bundle.
  return candidates.reduce((cheapest, pkg) =>
    pkg.priceCents < cheapest.priceCents ? pkg : cheapest,
  )
}

// Cart rules the booking form must block/explain before submitting.
//  - 'auto-only-under-minimum': Auto Maintenance items are add-on only. An
//    auto-only cart is bookable only when ≥2 items together clear the $95
//    minimum; below that they must ride along with another service.
export type CartViolation = 'auto-only-under-minimum'

export function cartViolations(cart: Cart): CartViolation[] {
  const { lines, pkg } = resolveCart(cart)
  if (pkg || lines.length === 0) return []
  if (!lines.every((line) => line.addOnOnly)) return []
  const { subtotalCents } = cartTotals(cart)
  return subtotalCents < PRICING.minimumCharge * 100
    ? ['auto-only-under-minimum']
    : []
}

function centsToDollars(cents: number): string {
  // Whole-dollar pricing throughout the menu; render without trailing .00.
  if (cents % 100 === 0) return `$${cents / 100}`
  return `$${(cents / 100).toFixed(2)}`
}

// Human-readable plain-text summary for the email body / calendar description.
// Pass { family: true } to render Forge Family prices so the lead David sees
// matches what the friend was quoted at booking. NO hour rendering anywhere —
// flat items and flat totals only (durations are internal).
export function formatCartSummary(cart: Cart, opts?: { family?: boolean }): string {
  const family = opts?.family ?? false
  const { lines, pkg } = resolveCart(cart)
  const priceOf = (display: string, cents: number) =>
    family ? familyPriceLabel(display, cents) : display

  if (pkg) {
    // Package-led summary. If à-la-carte items ride along, list them after.
    const scope = pkg.itemCount != null ? `up to ${pkg.itemCount} fixes` : 'full punch list'
    const header = `PACKAGE: #${pkg.number} ${pkg.name} (${scope}) — ${priceOf(pkg.price, pkg.priceCents)}`
    if (lines.length === 0) return header
    const bullets = lines.map(
      (line) => `• ${line.name} ×${line.qty} — ${priceOf(line.price, line.priceCents)}`,
    )
    return [header, '', ...bullets].join('\n')
  }

  if (lines.length === 0) return ''

  const { itemCount, subtotalCents } = cartTotals(cart, { family })
  // On a multi-unit cart, show each line's add-on price next to its full price
  // so the bullets visibly add up to the engine total David quotes from.
  const multiUnit = itemCount > 1
  const bullets = lines.map((line) => {
    let priced = priceOf(line.price, line.priceCents)
    if (multiUnit && line.addOnCents != null && line.addOnCents !== line.priceCents) {
      priced += ` first / ${priceOf(line.addOnPrice!, line.addOnCents)} add-on`
    }
    return `• ${line.name} ×${line.qty} — ${priced}`
  })
  const estimate = `Estimated: ${itemCount} item${itemCount === 1 ? '' : 's'} · ${centsToDollars(
    subtotalCents,
  )} (final on site)`
  return [...bullets, '', estimate].join('\n')
}

// Map the cart's sections to back-compat SERVICE_CATEGORIES codes. A
// package-only cart -> ['multiple']; empty -> []. De-duplicated, order-stable.
export function deriveServiceCategories(cart: Cart): string[] {
  const { lines, pkg } = resolveCart(cart)

  if (lines.length === 0) {
    return pkg ? ['multiple'] : []
  }

  const seen = new Set<string>()
  const codes: string[] = []
  for (const line of lines) {
    const code = CATEGORY_CODE_BY_SECTION[line.category]
    if (!seen.has(code)) {
      seen.add(code)
      codes.push(code)
    }
  }
  return codes
}

// True when the cart has no à-la-carte items and no package selected.
export function isCartEmpty(cart: Cart): boolean {
  return cart.items.length === 0 && cart.packageNumber == null
}

function dollarsStrToCents(s: string): number {
  return Math.round(parseFloat(s) * 100)
}

// Pull the numeric estimate (in cents) back out of a job's description, which
// leads with the priced cart summary that formatCartSummary() wrote at booking
// (family-aware). Lets the quote composer pre-fill the amount for a
// self-scheduled job so it's a review-and-send, not a retype. Returns null for
// custom / "not sure" jobs (no priced summary to read). The structured cart
// isn't persisted yet (Phase D), so this reads the summary we already store.
//
// MUST stay backward-compatible: jobs booked before the flat-rate rework
// stored the old formats — "Estimated: N items · ~H hrs · $TOTAL (final on
// site)" and "PACKAGE: #N Name (H hrs) — $PRICE" — and the quote composer
// still reads those descriptions. Both regexes skip to the first "$" after
// the marker, so old (with hour text) and new (without) formats parse alike.
export function estimateCentsFromDescription(
  description: string | null | undefined,
): number | null {
  if (!description) return null
  // À-la-carte summary ends with: "Estimated: N items · $TOTAL (final on site)"
  // (legacy: "Estimated: N items · ~H hrs · $TOTAL (final on site)")
  const alc = description.match(
    /Estimated:[^$]*\$(\d+(?:\.\d{2})?)\s*\(final on site\)/,
  )
  if (alc) return dollarsStrToCents(alc[1])
  // Package summary leads with: "PACKAGE: #N Name (up to N fixes) — $PRICE"
  // (legacy: "PACKAGE: #N Name (H hrs) — $PRICE"; #3 renders "from $PRICE")
  const pkg = description.match(/PACKAGE:[^$]*\$(\d+(?:\.\d{2})?)/)
  if (pkg) return dollarsStrToCents(pkg[1])
  return null
}
