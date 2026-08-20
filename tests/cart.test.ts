import { describe, it, expect } from 'vitest'
import {
  resolveCart,
  cartTotals,
  cartJobMinutes,
  cartViolations,
  suggestPackage,
  deriveServiceCategories,
  formatCartSummary,
  isCartEmpty,
  estimateCentsFromDescription,
  type Cart,
} from '@/lib/cart'
import { SERVICE_MENU, SERVICE_PACKAGES } from '@/lib/constants'
import { familyCents } from '@/lib/family-pricing'

// Pure unit tests for the cart logic. No mocks — the cart reads SERVICE_MENU /
// SERVICE_PACKAGES straight from constants, so the ids and numbers below are
// the real menu (e.g. 'ceiling-fan', 'faucet-replace', 'tv-standard',
// 'light-fixture'). Keep these in sync with lib/constants.ts.

// Pull the real menu item so assertions don't hard-code copy that may change.
function menuItem(id: string) {
  for (const section of SERVICE_MENU) {
    const item = section.items.find((i) => i.id === id)
    if (item) return item
  }
  throw new Error(`test fixture references unknown menu id: ${id}`)
}

describe('menu add-on pricing (derived in constants)', () => {
  it('derives add-on = full − $30, $5-rounded-down, floor $45, for items under $200', () => {
    expect(menuItem('light-fixture').addOnCents).toBe(8000) // $110 → $80
    expect(menuItem('door-knob').addOnCents).toBe(6500) // $95 → $65
    expect(menuItem('recaulk').addOnCents).toBe(9500) // $125 → $95
    expect(menuItem('ceiling-fan').addOnCents).toBe(10500) // $135 → $105
    expect(menuItem('faucet-replace').addOnCents).toBe(14500) // $175 → $145
  })

  it('gives $200+ items no add-on price — they always charge full', () => {
    for (const id of ['toilet-install', 'patch-paint', 'room-walls', 'trim-doors', 'tv-large']) {
      expect(menuItem(id).addOnCents, id).toBeNull()
      expect(menuItem(id).addOnPrice, id).toBeNull()
      expect(menuItem(id).packageEligible, id).toBe(false)
    }
  })

  it('auto-maintenance items are add-on only: addOnCents = priceCents, never package-eligible', () => {
    for (const id of ['wiper-blades', 'cabin-air-filter', 'car-battery']) {
      const item = menuItem(id)
      expect(item.addOnCents, id).toBe(item.priceCents)
      expect(item.packageEligible, id).toBe(false)
    }
  })

  it('marks small fixes (≤ $135, non-auto) package-eligible', () => {
    expect(menuItem('light-fixture').packageEligible).toBe(true)
    expect(menuItem('ceiling-fan').packageEligible).toBe(true)
    expect(menuItem('faucet-replace').packageEligible).toBe(false) // $175 > $135
  })
})

describe('resolveCart', () => {
  it('resolves known ids to lines carrying the menu name/prices/minutes', () => {
    const cart: Cart = {
      items: [
        { id: 'ceiling-fan', qty: 1 },
        { id: 'faucet-replace', qty: 2 },
      ],
      packageNumber: null,
    }
    const { lines, pkg } = resolveCart(cart)

    expect(pkg).toBeNull()
    expect(lines).toHaveLength(2)

    const fan = lines.find((l) => l.id === 'ceiling-fan')!
    const fanMenu = menuItem('ceiling-fan')
    expect(fan.name).toBe(fanMenu.name)
    expect(fan.price).toBe(fanMenu.price)
    expect(fan.priceCents).toBe(fanMenu.priceCents)
    expect(fan.addOnCents).toBe(fanMenu.addOnCents)
    expect(fan.minutes).toBe(fanMenu.minutes)
    expect(fan.qty).toBe(1)
    expect(fan.category).toBe('Installation & Furniture Assembly')

    const faucet = lines.find((l) => l.id === 'faucet-replace')!
    expect(faucet.qty).toBe(2)
    expect(faucet.category).toBe('Minor Plumbing')
  })

  it('ignores unknown ids and keeps the known ones', () => {
    const cart: Cart = {
      items: [
        { id: 'definitely-not-a-real-id', qty: 1 },
        { id: 'tv-standard', qty: 1 },
      ],
      packageNumber: null,
    }
    const { lines } = resolveCart(cart)
    expect(lines.map((l) => l.id)).toEqual(['tv-standard'])
  })

  it('resolves a packageNumber to the matching package', () => {
    const { pkg } = resolveCart({ items: [], packageNumber: 2 })
    const expected = SERVICE_PACKAGES.find((p) => p.number === 2)!
    expect(pkg).not.toBeNull()
    expect(pkg!.number).toBe(2)
    expect(pkg!.name).toBe(expected.name)
    expect(pkg!.priceCents).toBe(expected.priceCents)
  })

  it('resolves a null/unknown packageNumber to null', () => {
    expect(resolveCart({ items: [], packageNumber: null }).pkg).toBeNull()
    expect(resolveCart({ items: [], packageNumber: 99 }).pkg).toBeNull()
  })
})

describe('cartTotals (the add-on pricing engine)', () => {
  it('4× light fixture = full + 3× add-on = $350', () => {
    const cart: Cart = {
      items: [{ id: 'light-fixture', qty: 4 }],
      packageNumber: null,
    }
    const totals = cartTotals(cart)
    expect(totals.subtotalCents).toBe(35000) // 110 + 3×80
    expect(totals.naiveSubtotalCents).toBe(44000) // 4×110 — old full-price sum
    expect(totals.itemCount).toBe(4)
  })

  it('charges full price exactly once, on the most expensive unit, in a mixed cart', () => {
    // ceiling-fan $135/$105 (most expensive) + light-fixture $110/$80 ×2
    const cart: Cart = {
      items: [
        { id: 'light-fixture', qty: 2 },
        { id: 'ceiling-fan', qty: 1 },
      ],
      packageNumber: null,
    }
    expect(cartTotals(cart).subtotalCents).toBe(13500 + 8000 * 2)
  })

  it('is order-independent (cannot be gamed by reordering)', () => {
    const forward: Cart = {
      items: [
        { id: 'ceiling-fan', qty: 1 },
        { id: 'door-knob', qty: 1 },
        { id: 'recaulk', qty: 1 },
      ],
      packageNumber: null,
    }
    const reversed: Cart = {
      items: [...forward.items].reverse(),
      packageNumber: null,
    }
    expect(cartTotals(forward).subtotalCents).toBe(cartTotals(reversed).subtotalCents)
    // 135 (fan, full) + 65 (knob add-on) + 95 (recaulk add-on)
    expect(cartTotals(forward).subtotalCents).toBe(13500 + 6500 + 9500)
  })

  it('$200+ items never discount and anchor the cart: toilet + door knob = 225 + 65', () => {
    const cart: Cart = {
      items: [
        { id: 'toilet-install', qty: 1 },
        { id: 'door-knob', qty: 1 },
      ],
      packageNumber: null,
    }
    expect(cartTotals(cart).subtotalCents).toBe(22500 + 6500)
  })

  it('two $200+ items both charge full price', () => {
    const cart: Cart = {
      items: [
        { id: 'toilet-install', qty: 1 },
        { id: 'tv-large', qty: 1 },
      ],
      packageNumber: null,
    }
    expect(cartTotals(cart).subtotalCents).toBe(22500 + 22500)
  })

  it('a single item charges full price (the $95 minimum falls out naturally)', () => {
    const cart: Cart = { items: [{ id: 'door-knob', qty: 1 }], packageNumber: null }
    const totals = cartTotals(cart)
    expect(totals.subtotalCents).toBe(9500)
    expect(totals.naiveSubtotalCents).toBe(9500)
  })

  it('sums minutes across items × qty and excludes the package from money totals', () => {
    const fan = menuItem('ceiling-fan')
    const faucet = menuItem('faucet-replace')
    const cart: Cart = {
      items: [
        { id: 'ceiling-fan', qty: 1 },
        { id: 'faucet-replace', qty: 2 },
      ],
      // A selected package must NOT change the à-la-carte totals.
      packageNumber: 3,
    }
    const totals = cartTotals(cart)
    expect(totals.itemCount).toBe(3)
    // faucet $175 is the anchor: 175 + 145 + 105 (fan add-on)
    expect(totals.subtotalCents).toBe(17500 + 14500 + 10500)
    expect(totals.minutes).toBe(fan.minutes + faucet.minutes * 2)
  })

  it('returns zeros for an empty cart', () => {
    expect(cartTotals({ items: [], packageNumber: null })).toEqual({
      itemCount: 0,
      subtotalCents: 0,
      naiveSubtotalCents: 0,
      minutes: 0,
    })
  })
})

describe('Forge Family pricing in the cart', () => {
  it('discounts each engine unit price individually with { family: true }', () => {
    // 2× ceiling fan: anchor at familyCents(full), second unit at familyCents(add-on).
    const fan = menuItem('ceiling-fan')
    const cart: Cart = { items: [{ id: 'ceiling-fan', qty: 2 }], packageNumber: null }
    const base = cartTotals(cart)
    const fam = cartTotals(cart, { family: true })
    expect(fam.itemCount).toBe(base.itemCount)
    expect(fam.minutes).toBe(base.minutes)
    expect(fam.subtotalCents).toBe(
      familyCents(fan.priceCents) + familyCents(fan.addOnCents!),
    )
    expect(fam.naiveSubtotalCents).toBe(familyCents(fan.priceCents) * 2)
    expect(fam.subtotalCents).toBeLessThan(base.subtotalCents)
  })

  it('family engine total matches per-line familyCents math on a mixed cart', () => {
    const cart: Cart = {
      items: [
        { id: 'light-fixture', qty: 2 },
        { id: 'ceiling-fan', qty: 1 }, // anchor ($135 full)
      ],
      packageNumber: null,
    }
    const fam = cartTotals(cart, { family: true })
    const fixture = menuItem('light-fixture')
    const fan = menuItem('ceiling-fan')
    expect(fam.subtotalCents).toBe(
      familyCents(fan.priceCents) + familyCents(fixture.addOnCents!) * 2,
    )
  })

  it('formatCartSummary renders family prices with { family: true }', () => {
    const fan = menuItem('ceiling-fan')
    const cart: Cart = { items: [{ id: 'ceiling-fan', qty: 1 }], packageNumber: null }
    const summary = formatCartSummary(cart, { family: true })
    expect(summary).toContain(`$${(familyCents(fan.priceCents) / 100).toString()}`)
    expect(summary).toContain(fan.name)
  })

  it('defaults to base pricing when no opts are passed (back-compat)', () => {
    const fan = menuItem('ceiling-fan')
    const cart: Cart = { items: [{ id: 'ceiling-fan', qty: 1 }], packageNumber: null }
    expect(cartTotals(cart).subtotalCents).toBe(fan.priceCents)
    expect(formatCartSummary(cart)).toContain(fan.price)
  })
})

describe('cartJobMinutes', () => {
  it('uses the package internal scheduling estimate, not hours', () => {
    const pkg1 = SERVICE_PACKAGES.find((p) => p.number === 1)!
    expect(cartJobMinutes({ items: [], packageNumber: 1 })).toBe(pkg1.estimatedMinutes)
  })

  it('returns 0 for the quote-first #3 so it routes to the callback/quote flow', () => {
    const pkg3 = SERVICE_PACKAGES.find((p) => p.number === 3)!
    expect(pkg3.quoteFirst).toBe(true)
    expect(cartJobMinutes({ items: [], packageNumber: 3 })).toBe(0)
  })

  it('sums à-la-carte minutes when no package is selected', () => {
    const fan = menuItem('ceiling-fan')
    expect(cartJobMinutes({ items: [{ id: 'ceiling-fan', qty: 2 }], packageNumber: null })).toBe(
      fan.minutes * 2,
    )
  })
})

describe('estimateCentsFromDescription (quote pre-fill)', () => {
  it('reads the package price from a package summary', () => {
    const pkg = SERVICE_PACKAGES.find((p) => p.number === 1)!
    const summary = formatCartSummary({ items: [], packageNumber: 1 })
    expect(estimateCentsFromDescription(summary)).toBe(pkg.priceCents)
  })

  it('reads the "from" floor for the quote-first #3', () => {
    const pkg = SERVICE_PACKAGES.find((p) => p.number === 3)!
    const summary = formatCartSummary({ items: [], packageNumber: 3 })
    expect(summary).toContain('from $')
    expect(estimateCentsFromDescription(summary)).toBe(pkg.priceCents)
  })

  it('reads the engine total from an item summary', () => {
    const summary = formatCartSummary({
      items: [{ id: 'light-fixture', qty: 4 }],
      packageNumber: null,
    })
    expect(estimateCentsFromDescription(summary)).toBe(35000)
  })

  it('reads the FAMILY total when the summary was family-priced', () => {
    const fan = menuItem('ceiling-fan')
    const summary = formatCartSummary(
      { items: [{ id: 'ceiling-fan', qty: 2 }], packageNumber: null },
      { family: true },
    )
    expect(estimateCentsFromDescription(summary)).toBe(
      familyCents(fan.priceCents) + familyCents(fan.addOnCents!),
    )
  })

  // Jobs booked before the flat-rate rework stored hour-based summaries. The
  // quote composer must keep parsing them — these strings are verbatim legacy
  // formats, do NOT regenerate them from today's formatCartSummary.
  it('still parses LEGACY package summaries with hour text', () => {
    expect(
      estimateCentsFromDescription('PACKAGE: #1 The Honey-Do (2 hrs) — $169'),
    ).toBe(16900)
    expect(
      estimateCentsFromDescription(
        '🏷️ FORGE FAMILY — 30% off applied\n\nPACKAGE: #2 The Half-Day (4 hrs) — $230',
      ),
    ).toBe(23000)
  })

  it('still parses LEGACY à-la-carte summaries with hour text', () => {
    const legacy =
      '• Light fixture swap ×4 — $110\n\nEstimated: 4 items · ~4 hrs · $440 (final on site)'
    expect(estimateCentsFromDescription(legacy)).toBe(44000)
  })

  it('returns null for a custom / no-summary description', () => {
    expect(
      estimateCentsFromDescription('Not sure what my fence needs — can you take a look?'),
    ).toBeNull()
    expect(estimateCentsFromDescription('')).toBeNull()
    expect(estimateCentsFromDescription(null)).toBeNull()
  })

  it('reads the total from a real stored description (family tag + note appended)', () => {
    const fan = menuItem('ceiling-fan')
    const summary = formatCartSummary(
      { items: [{ id: 'ceiling-fan', qty: 1 }], packageNumber: null },
      { family: true },
    )
    // Mirrors what the contact route stores: family tag, summary, free-text note
    // (the note even contains a stray "$" to prove it doesn't get picked up).
    const stored = `🏷️ FORGE FAMILY — 30% off applied\n\n${summary}\n\nNote: my budget is around $200, please bring a ladder.`
    expect(estimateCentsFromDescription(stored)).toBe(familyCents(fan.priceCents))
  })
})

describe('suggestPackage (item-count bundles)', () => {
  it('suggests the #1 for 3 eligible small fixes, and only at or under the engine subtotal', () => {
    const cart: Cart = {
      items: [
        { id: 'door-knob', qty: 1 },
        { id: 'smoke-detector', qty: 1 },
        { id: 'hanging', qty: 1 },
      ],
      packageNumber: null,
    }
    const suggestion = suggestPackage(cart)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.number).toBe(1)
    expect(suggestion!.priceCents).toBeLessThanOrEqual(cartTotals(cart).subtotalCents)
  })

  it('suggests the #2 for 6 eligible small fixes', () => {
    const cart: Cart = {
      items: [{ id: 'door-knob', qty: 6 }],
      packageNumber: null,
    }
    const suggestion = suggestPackage(cart)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.number).toBe(2)
    expect(suggestion!.priceCents).toBeLessThanOrEqual(cartTotals(cart).subtotalCents)
  })

  it('suggests the #2 as a headroom upsell for 4–5 fixes (covers up to 6)', () => {
    const cart: Cart = {
      items: [{ id: 'light-fixture', qty: 4 }],
      packageNumber: null,
    }
    const suggestion = suggestPackage(cart)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.number).toBe(2)
  })

  it('returns null under 3 eligible items', () => {
    const cart: Cart = {
      items: [{ id: 'ceiling-fan', qty: 2 }],
      packageNumber: null,
    }
    expect(suggestPackage(cart)).toBeNull()
  })

  it('does not count big-ticket or auto items toward eligibility (and never drops them)', () => {
    // 3 eligible smalls + a toilet: a bundle can't cover the toilet, and
    // accepting a nudge would silently drop it — so no suggestion at all.
    expect(
      suggestPackage({
        items: [
          { id: 'door-knob', qty: 3 },
          { id: 'toilet-install', qty: 1 },
        ],
        packageNumber: null,
      }),
    ).toBeNull()
    // Auto items are not small fixes: 3 wiper swaps get no bundle nudge.
    expect(
      suggestPackage({
        items: [{ id: 'wiper-blades', qty: 3 }],
        packageNumber: null,
      }),
    ).toBeNull()
  })

  it('returns null past bundle capacity (7+ fixes go to the quote-first #3 by hand)', () => {
    expect(
      suggestPackage({ items: [{ id: 'door-knob', qty: 7 }], packageNumber: null }),
    ).toBeNull()
  })

  it('returns null when the cart is already on a package', () => {
    const cart: Cart = {
      items: [{ id: 'door-knob', qty: 3 }],
      packageNumber: 2,
    }
    expect(suggestPackage(cart)).toBeNull()
  })
})

describe('cartViolations (auto maintenance is add-on only)', () => {
  it('flags an auto-only cart under the $95 minimum', () => {
    expect(
      cartViolations({ items: [{ id: 'car-battery', qty: 1 }], packageNumber: null }),
    ).toEqual(['auto-only-under-minimum'])
    // 2× wipers = $90, still under.
    expect(
      cartViolations({ items: [{ id: 'wiper-blades', qty: 2 }], packageNumber: null }),
    ).toEqual(['auto-only-under-minimum'])
  })

  it('allows ≥2 auto items that together clear $95', () => {
    expect(
      cartViolations({
        items: [
          { id: 'car-battery', qty: 1 },
          { id: 'headlight-restore', qty: 1 },
        ],
        packageNumber: null,
      }),
    ).toEqual([])
  })

  it('allows auto items riding along with another service', () => {
    expect(
      cartViolations({
        items: [
          { id: 'wiper-blades', qty: 1 },
          { id: 'door-knob', qty: 1 },
        ],
        packageNumber: null,
      }),
    ).toEqual([])
  })

  it('does not flag empty or package carts', () => {
    expect(cartViolations({ items: [], packageNumber: null })).toEqual([])
    expect(cartViolations({ items: [], packageNumber: 1 })).toEqual([])
  })
})

describe('deriveServiceCategories', () => {
  it('maps a Minor Plumbing item to ["plumbing"]', () => {
    expect(
      deriveServiceCategories({
        items: [{ id: 'faucet-replace', qty: 1 }],
        packageNumber: null,
      }),
    ).toEqual(['plumbing'])
  })

  it('dedupes a TV + Install cart to ["mounting"]', () => {
    expect(
      deriveServiceCategories({
        items: [
          { id: 'tv-standard', qty: 1 },
          { id: 'furniture', qty: 1 },
        ],
        packageNumber: null,
      }),
    ).toEqual(['mounting'])
  })

  it('maps a package-only cart to ["multiple"]', () => {
    expect(
      deriveServiceCategories({ items: [], packageNumber: 1 }),
    ).toEqual(['multiple'])
  })

  it('maps an empty cart to []', () => {
    expect(
      deriveServiceCategories({ items: [], packageNumber: null }),
    ).toEqual([])
  })
})

describe('formatCartSummary', () => {
  it('renders the package header as item counts, never hours', () => {
    const pkg = SERVICE_PACKAGES.find((p) => p.number === 1)!
    const summary = formatCartSummary({ items: [], packageNumber: 1 })
    expect(summary).toBe(
      `PACKAGE: #1 ${pkg.name} (${pkg.itemCount} fixes) — ${pkg.price}`,
    )
  })

  it('renders the quote-first #3 with its "from" price and full-list scope', () => {
    const pkg = SERVICE_PACKAGES.find((p) => p.number === 3)!
    const summary = formatCartSummary({ items: [], packageNumber: 3 })
    expect(summary).toContain('full punch list')
    expect(summary).toContain(pkg.price) // "from $649"
  })

  it('renders the à-la-carte estimate as the flat engine total, no hours', () => {
    const summary = formatCartSummary({
      items: [{ id: 'light-fixture', qty: 4 }],
      packageNumber: null,
    })
    expect(summary).toContain('Estimated: 4 items · $350 (final on site)')
  })

  it('never renders hour text anywhere in a summary', () => {
    const carts: Cart[] = [
      { items: [], packageNumber: 1 },
      { items: [], packageNumber: 2 },
      { items: [], packageNumber: 3 },
      { items: [{ id: 'light-fixture', qty: 4 }], packageNumber: null },
      {
        items: [
          { id: 'ceiling-fan', qty: 1 },
          { id: 'room-walls', qty: 1 },
        ],
        packageNumber: null,
      },
    ]
    for (const cart of carts) {
      for (const family of [false, true]) {
        expect(formatCartSummary(cart, { family })).not.toMatch(/\bhrs?\b|\bhours?\b/i)
      }
    }
  })

  it('includes each item name and the package line', () => {
    const cart: Cart = {
      items: [
        { id: 'ceiling-fan', qty: 1 },
        { id: 'room-walls', qty: 1 },
      ],
      packageNumber: 1,
    }
    const summary = formatCartSummary(cart)
    const pkg = SERVICE_PACKAGES.find((p) => p.number === 1)!

    expect(summary).toContain(menuItem('ceiling-fan').name)
    expect(summary).toContain(menuItem('room-walls').name)
    expect(summary).toContain(`#${pkg.number}`)
    expect(summary).toContain(pkg.name)
  })

  it('returns an empty string for an empty cart', () => {
    expect(formatCartSummary({ items: [], packageNumber: null })).toBe('')
  })
})

describe('pricing invariants (flag violations for Mitch — never silently adjust)', () => {
  // Every fixed-count bundle must beat (or match) the à-la-carte alternative:
  // its price may not exceed the engine total of the cheapest possible basket
  // of package-eligible items — the customer's worst-case comparison.
  it('every bundle stays at or under the cheapest qualifying à-la-carte basket', () => {
    const eligible = SERVICE_MENU.flatMap((s) => s.items).filter(
      (i) => i.packageEligible,
    )
    const cheapest = eligible.reduce((a, b) => (b.priceCents < a.priceCents ? b : a))
    for (const pkg of SERVICE_PACKAGES) {
      if (pkg.itemCount == null) continue // #3 is quote-first, no fixed basket
      const basketCents =
        cheapest.priceCents + cheapest.addOnCents! * (pkg.itemCount - 1)
      expect(
        pkg.priceCents,
        `#${pkg.number} ${pkg.name} ($${pkg.priceCents / 100}) must not exceed ` +
          `the cheapest ${pkg.itemCount}-item à-la-carte basket ($${basketCents / 100})`,
      ).toBeLessThanOrEqual(basketCents)
    }
  })

  // There is deliberately NO wage-floor invariant: Forge is a new business
  // and prices must sit at or below competitors' (Mitch, 2026-08-20) — the
  // only hard rule is the ceiling above, which keeps the customer-facing
  // "bundles beat à la carte" promise true.

  it('no package renders hours in its customer-facing fields', () => {
    for (const pkg of SERVICE_PACKAGES) {
      for (const text of [pkg.name, pkg.price, pkg.scope, pkg.blurb]) {
        expect(text).not.toMatch(/\bhrs?\b|\bhours?\b|\bhourly\b/i)
      }
    }
  })
})

describe('isCartEmpty', () => {
  it('is true when there are no items and no package', () => {
    expect(isCartEmpty({ items: [], packageNumber: null })).toBe(true)
  })

  it('is false when an item is present', () => {
    expect(
      isCartEmpty({ items: [{ id: 'ceiling-fan', qty: 1 }], packageNumber: null }),
    ).toBe(false)
  })

  it('is false when a package is selected', () => {
    expect(isCartEmpty({ items: [], packageNumber: 2 })).toBe(false)
  })
})
