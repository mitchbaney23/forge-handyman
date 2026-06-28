import {
  PACKAGE_MINUTES,
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
  minutes: number
  category: ServiceCategory
}

// Map of menu item id -> { item, category } for O(1) lookup. Built once.
const MENU_INDEX: Map<string, { item: MenuItem; category: ServiceCategory }> =
  new Map(
    SERVICE_MENU.flatMap((section) =>
      section.items.map(
        (item) =>
          [item.id, { item, category: section.category }] as const,
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
    const { item, category } = found
    lines.push({
      id: item.id,
      name: item.name,
      qty: clampQty(selection.qty),
      price: item.price,
      priceCents: item.priceCents,
      minutes: item.minutes,
      category,
    })
  }
  return { lines, pkg: resolvePackage(cart.packageNumber) }
}

// À-la-carte totals only — does NOT include the package. Pass { family: true }
// to total at Forge Family rates (each line discounted + $5-rounded, exactly as
// the /family page shows) — keeps the booking estimate in sync with the promise.
export function cartTotals(
  cart: Cart,
  opts?: { family?: boolean },
): {
  itemCount: number
  subtotalCents: number
  minutes: number
} {
  const family = opts?.family ?? false
  const { lines } = resolveCart(cart)
  let itemCount = 0
  let subtotalCents = 0
  let minutes = 0
  for (const line of lines) {
    itemCount += line.qty
    const unitCents = family ? familyCents(line.priceCents) : line.priceCents
    subtotalCents += unitCents * line.qty
    minutes += line.minutes * line.qty
  }
  return { itemCount, subtotalCents, minutes }
}

// The job duration in minutes implied by a cart: the package block when a
// package is chosen, else the summed à-la-carte minutes. Returns 0 for an empty
// cart (a custom / "not sure" job has no known duration — the caller routes
// those to the callback fallback rather than the slot picker).
export function cartJobMinutes(cart: Cart): number {
  if (cart.packageNumber != null) {
    return PACKAGE_MINUTES[cart.packageNumber] ?? 0
  }
  return cartTotals(cart).minutes
}

// The package nudge. When a cart has à-la-carte items (and no package selected)
// whose total minutes >= PACKAGE_MINUTES[1] (120), return the cheapest package
// whose block minutes >= the cart minutes AND whose priceCents <= the à-la-carte
// subtotal (so it genuinely saves money or matches). Otherwise null.
export function suggestPackage(cart: Cart): ServicePackage | null {
  if (cart.packageNumber != null) return null
  const { subtotalCents, minutes } = cartTotals(cart)
  if (minutes < PACKAGE_MINUTES[1]) return null

  const candidates = SERVICE_PACKAGES.filter((pkg) => {
    const blockMinutes = PACKAGE_MINUTES[pkg.number] ?? pkg.hours * 60
    return blockMinutes >= minutes && pkg.priceCents <= subtotalCents
  })
  if (candidates.length === 0) return null

  // Cheapest qualifying package.
  return candidates.reduce((cheapest, pkg) =>
    pkg.priceCents < cheapest.priceCents ? pkg : cheapest,
  )
}

function centsToDollars(cents: number): string {
  // Whole-dollar pricing throughout the menu; render without trailing .00.
  if (cents % 100 === 0) return `$${cents / 100}`
  return `$${(cents / 100).toFixed(2)}`
}

function formatHours(minutes: number): string {
  const hours = minutes / 60
  // Trim a trailing .0 (e.g. 2.0 -> 2) but keep halves (2.5).
  const rounded = Math.round(hours * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

// Human-readable plain-text summary for the email body / calendar description.
// Pass { family: true } to render Forge Family prices so the lead David sees
// matches what the friend was quoted at booking.
export function formatCartSummary(cart: Cart, opts?: { family?: boolean }): string {
  const family = opts?.family ?? false
  const { lines, pkg } = resolveCart(cart)
  const priceOf = (display: string, cents: number) =>
    family ? familyPriceLabel(display, cents) : display

  if (pkg) {
    // Package-led summary. If à-la-carte items ride along, list them after.
    const header = `PACKAGE: #${pkg.number} ${pkg.name} (${pkg.hours} hrs) — ${priceOf(pkg.price, pkg.priceCents)}`
    if (lines.length === 0) return header
    const bullets = lines.map(
      (line) => `• ${line.name} ×${line.qty} — ${priceOf(line.price, line.priceCents)}`,
    )
    return [header, '', ...bullets].join('\n')
  }

  if (lines.length === 0) return ''

  const bullets = lines.map(
    (line) => `• ${line.name} ×${line.qty} — ${priceOf(line.price, line.priceCents)}`,
  )
  const { itemCount, subtotalCents, minutes } = cartTotals(cart, { family })
  const estimate = `Estimated: ${itemCount} item${itemCount === 1 ? '' : 's'} · ~${formatHours(
    minutes,
  )} hrs · ${centsToDollars(subtotalCents)} (final on site)`
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
