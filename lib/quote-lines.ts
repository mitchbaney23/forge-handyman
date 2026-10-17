import { itemizeLines, resolveCart, type Cart, type CartSelection } from '@/lib/cart'
import { SERVICE_MENU, SERVICE_PACKAGES } from '@/lib/constants'
import { familyCents } from '@/lib/family-pricing'

// ---------------------------------------------------------------------------
// Itemized quotes from the flat-rate menu. Pure and framework-free: the admin
// quote composer (client) prices with it live, and the quote core
// (lib/crm/quote.ts) re-prices with it on the server before anything is sent,
// so the number on screen and the number emailed come from the same code.
//
// A menu quote is a Cart (lib/cart.ts): menu items with a quantity, plus at
// most one fixed-price bundle. Items price through the cart's add-on engine
// (itemizeLines); the bundle is its posted flat price, as at booking. Nothing
// here can price above the posted menu: there are no price overrides — custom
// work goes through the free-form deposit/balance quote instead.
// ---------------------------------------------------------------------------

// Matches the booking cart's per-line cap (resolveCart clamps to 10), so a
// quote never prices a quantity the engine would silently change.
export const QUOTE_MAX_QTY = 10
export const QUOTE_MAX_LINES = 20
// Stripe will not sell a $0 line item, and a deposit is what saves the card.
export const MIN_DEPOSIT_CENTS = 100

// The fixed-price bundles. The #3 is quote-first (one number from photos), so
// it goes out as a custom-amount quote.
export const QUOTABLE_PACKAGES = SERVICE_PACKAGES.filter((p) => !p.quoteFirst)

const MENU_NAME_BY_ID = new Map(
  SERVICE_MENU.flatMap((section) => section.items.map((item) => [item.id, item.name] as const)),
)
const MENU_ID_BY_NAME = new Map(
  SERVICE_MENU.flatMap((section) => section.items.map((item) => [item.name, item.id] as const)),
)

export type QuoteLine = {
  kind: 'item' | 'package'
  // The menu item id, or `package-<number>` for a bundle.
  id: string
  name: string
  qty: number
  unitCents: number
  fullUnitCents: number
  // Charged at the item's add-on price (lower than its full price).
  addOn: boolean
  totalCents: number
}

export type ItemizedQuote = {
  lines: QuoteLine[]
  totalCents: number
  family: boolean
}

export function packageLineId(packageNumber: number): string {
  return `package-${packageNumber}`
}

// Jobs booked through /family carry the marker at the top of the description
// ("🏷️ FORGE FAMILY — 30% off applied", app/api/contact/route.ts).
export function isForgeFamilyJob(description: string | null | undefined): boolean {
  return /^\W*FORGE FAMILY\b/.test(description ?? '')
}

export type ParsedQuoteCart = { ok: true; cart: Cart } | { ok: false; error: string }

// Validate an untrusted menu selection (admin form, MCP tool input). Strict
// where the booking cart is forgiving: an unknown id, a bad quantity or a
// duplicate line is refused with a reason rather than dropped or clamped,
// because the person sending the quote has to see what will be charged.
export function parseQuoteCart(input: unknown): ParsedQuoteCart {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Pick at least one menu item or bundle.' }
  const raw = input as { items?: unknown; packageNumber?: unknown }
  const rawItems = raw.items ?? []
  if (!Array.isArray(rawItems)) return { ok: false, error: 'Menu items must be a list.' }
  if (rawItems.length > QUOTE_MAX_LINES) {
    return { ok: false, error: `A quote can list at most ${QUOTE_MAX_LINES} menu items.` }
  }

  const items: CartSelection[] = []
  const seen = new Set<string>()
  for (const entry of rawItems) {
    const id = (entry as { id?: unknown } | null)?.id
    const qty = (entry as { qty?: unknown } | null)?.qty
    if (typeof id !== 'string' || !MENU_NAME_BY_ID.has(id)) {
      return { ok: false, error: `Unknown menu item: ${String(id)}. Use an id from the price menu.` }
    }
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > QUOTE_MAX_QTY) {
      return {
        ok: false,
        error: `${MENU_NAME_BY_ID.get(id)}: quantity must be a whole number from 1 to ${QUOTE_MAX_QTY}.`,
      }
    }
    if (seen.has(id)) {
      return { ok: false, error: `${MENU_NAME_BY_ID.get(id)} is listed twice; set its quantity instead.` }
    }
    seen.add(id)
    items.push({ id, qty })
  }

  let packageNumber: number | null = null
  if (raw.packageNumber != null) {
    const pkg = SERVICE_PACKAGES.find((p) => p.number === raw.packageNumber)
    if (!pkg) return { ok: false, error: `Unknown bundle: ${String(raw.packageNumber)}.` }
    if (pkg.quoteFirst) {
      return {
        ok: false,
        error: `The #${pkg.number} ${pkg.name} is priced from photos; send it as a custom amount.`,
      }
    }
    packageNumber = pkg.number
  }

  if (items.length === 0 && packageNumber == null) {
    return { ok: false, error: 'Pick at least one menu item or bundle.' }
  }
  return { ok: true, cart: { items, packageNumber } }
}

// Price a validated menu cart into the lines the customer sees. The bundle
// (if any) leads at its flat price; the menu items follow, priced by the add-on
// engine on their own — so the total is exactly what the posted menu charges
// for the bundle plus those items.
export function itemizeQuote(cart: Cart, opts?: { family?: boolean }): ItemizedQuote {
  const family = opts?.family ?? false
  const { lines, pkg } = resolveCart(cart)
  const quoteLines: QuoteLine[] = []

  if (pkg && !pkg.quoteFirst) {
    const cents = family ? familyCents(pkg.priceCents) : pkg.priceCents
    const scope = pkg.itemCount != null ? ` (up to ${pkg.itemCount} small fixes)` : ''
    quoteLines.push({
      kind: 'package',
      id: packageLineId(pkg.number),
      name: `#${pkg.number} ${pkg.name}${scope}`,
      qty: 1,
      unitCents: cents,
      fullUnitCents: cents,
      addOn: false,
      totalCents: cents,
    })
  }

  for (const row of itemizeLines(lines, { family })) {
    quoteLines.push({ kind: 'item', ...row, totalCents: row.unitCents * row.qty })
  }

  return {
    lines: quoteLines,
    totalCents: quoteLines.reduce((sum, line) => sum + line.totalCents, 0),
    family,
  }
}

export type MenuQuotePlan =
  | { ok: true; quote: ItemizedQuote; depositCents: number; balanceCents: number }
  | { ok: false; error: string }

// Everything a menu quote needs before it can be sent: validate the cart,
// price it at the job's rate (Forge Family when the job carries the marker),
// and split it into deposit + balance. The deposit defaults to the whole
// total; a smaller deposit leaves the rest as the balance charged at
// completion, so deposit + balance always equals the menu total.
export function planMenuQuote(
  menu: unknown,
  jobDescription: string | null | undefined,
  depositCents?: number,
): MenuQuotePlan {
  const parsed = parseQuoteCart(menu)
  if (!parsed.ok) return parsed
  const quote = itemizeQuote(parsed.cart, { family: isForgeFamilyJob(jobDescription) })
  const deposit = depositCents ?? quote.totalCents
  if (!Number.isInteger(deposit) || deposit < MIN_DEPOSIT_CENTS) {
    return { ok: false, error: 'Deposit must be at least $1.00' }
  }
  if (deposit > quote.totalCents) {
    return { ok: false, error: `Deposit can't be more than the ${formatCents(quote.totalCents)} total` }
  }
  return { ok: true, quote, depositCents: deposit, balanceCents: quote.totalCents - deposit }
}

export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// How a line is named on the Stripe checkout page and in plain-text email.
export function quoteLineLabel(line: Pick<QuoteLine, 'name' | 'addOn'>): string {
  return line.addOn ? `${line.name} (add-on price)` : line.name
}

// "Light fixture swap (add-on price) — 2 × $55.00 = $110.00"
export function formatQuoteLineText(line: QuoteLine): string {
  return `${quoteLineLabel(line)} — ${line.qty} × ${formatCents(line.unitCents)} = ${formatCents(line.totalCents)}`
}

// A one-line scope for places that need a short name (the Stripe product on a
// deposit-only link): "Light fixture swap ×3, Door knob replacement ×1".
export function summarizeQuoteLines(lines: QuoteLine[]): string {
  const qtyById = new Map<string, { name: string; qty: number }>()
  for (const line of lines) {
    const entry = qtyById.get(line.id)
    if (entry) entry.qty += line.qty
    else qtyById.set(line.id, { name: line.name, qty: line.qty })
  }
  return Array.from(qtyById.values())
    .map(({ name, qty }) => `${name} ×${qty}`)
    .join(', ')
}

// The cart a set of quoted lines came from (a split anchor line folds back
// into one selection). Used to pre-fill a re-quote from the last one sent.
export function cartFromQuoteLines(lines: QuoteLine[]): Cart {
  const items: CartSelection[] = []
  let packageNumber: number | null = null
  for (const line of lines) {
    if (line.kind === 'package') {
      const n = Number(line.id.slice('package-'.length))
      if (Number.isInteger(n)) packageNumber = n
      continue
    }
    const existing = items.find((i) => i.id === line.id)
    if (existing) existing.qty += line.qty
    else items.push({ id: line.id, qty: line.qty })
  }
  return { items, packageNumber }
}

// Read back the menu cart a self-scheduled booking picked, from the summary
// formatCartSummary() wrote into the job description ("• Name ×2 — …" and
// "PACKAGE: #1 …"). Names that no longer match the menu come back in
// `unmatched` so the composer can say what it could not pre-fill. null when
// the description holds no booking summary at all (a custom request).
export function menuCartFromDescription(
  description: string | null | undefined,
): { cart: Cart; unmatched: string[] } | null {
  if (!description) return null
  const items: CartSelection[] = []
  const unmatched: string[] = []
  for (const match of description.matchAll(/^• (.+?) ×(\d+) — /gm)) {
    const id = MENU_ID_BY_NAME.get(match[1])
    const qty = Math.min(Number(match[2]), QUOTE_MAX_QTY)
    if (!id || qty < 1) {
      unmatched.push(match[1])
      continue
    }
    const existing = items.find((i) => i.id === id)
    if (existing) existing.qty = Math.min(existing.qty + qty, QUOTE_MAX_QTY)
    else items.push({ id, qty })
  }

  let packageNumber: number | null = null
  const pkgMatch = description.match(/PACKAGE: #(\d+)\s*([^(—\n]*)/)
  if (pkgMatch) {
    const pkg = QUOTABLE_PACKAGES.find((p) => p.number === Number(pkgMatch[1]))
    if (pkg) packageNumber = pkg.number
    else unmatched.push(`#${pkgMatch[1]} ${pkgMatch[2].trim()}`.trim())
  }

  if (items.length === 0 && packageNumber == null && unmatched.length === 0) return null
  return { cart: { items, packageNumber }, unmatched }
}

// The itemized part of a quote.sent activity payload, read back defensively
// (the job page and preview_quote show what was quoted). null for quotes sent
// as a custom amount, or before quotes were itemized.
export function readQuotedLines(after: unknown): ItemizedQuote | null {
  if (!after || typeof after !== 'object') return null
  const { lines, totalCents, family } = after as { lines?: unknown; totalCents?: unknown; family?: unknown }
  if (!Array.isArray(lines) || lines.length === 0 || typeof totalCents !== 'number') return null
  const parsed: QuoteLine[] = []
  for (const raw of lines) {
    const l = raw as Partial<QuoteLine> | null
    if (
      !l ||
      (l.kind !== 'item' && l.kind !== 'package') ||
      typeof l.id !== 'string' ||
      typeof l.name !== 'string' ||
      typeof l.qty !== 'number' ||
      typeof l.unitCents !== 'number' ||
      typeof l.totalCents !== 'number'
    ) {
      return null
    }
    parsed.push({
      kind: l.kind,
      id: l.id,
      name: l.name,
      qty: l.qty,
      unitCents: l.unitCents,
      fullUnitCents: typeof l.fullUnitCents === 'number' ? l.fullUnitCents : l.unitCents,
      addOn: l.addOn === true,
      totalCents: l.totalCents,
    })
  }
  return { lines: parsed, totalCents, family: family === true }
}
