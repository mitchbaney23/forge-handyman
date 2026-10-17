import { describe, expect, it } from 'vitest'
import { cartTotals, formatCartSummary, type Cart } from '@/lib/cart'
import { SERVICE_MENU, SERVICE_PACKAGES } from '@/lib/constants'
import { familyCents } from '@/lib/family-pricing'
import {
  QUOTE_MAX_QTY,
  cartFromQuoteLines,
  customFromQuoteLines,
  formatCents,
  formatQuoteLineText,
  isForgeFamilyJob,
  itemizeQuote,
  menuCartFromDescription,
  parseCustomLines,
  parseQuoteCart,
  planMenuQuote,
  readQuotedLines,
  summarizeQuoteLines,
} from '@/lib/quote-lines'

// lib/quote-lines.ts: itemized quotes priced from the real flat-rate menu (no
// mocks — the ids and numbers are lib/constants.ts). What is pinned: each line
// is priced by the cart's add-on engine (most expensive item one unit full,
// every other unit its add-on price, $200+ items always full, Forge Family
// discounting each unit), the itemized total is exactly the booking cart's
// total, and nothing ever prices above the posted menu.

const cart = (items: [string, number][], packageNumber: number | null = null): Cart => ({
  items: items.map(([id, qty]) => ({ id, qty })),
  packageNumber,
})

const ALL_ITEMS = SERVICE_MENU.flatMap((section) => section.items)

function hasLowerAddOnPrice(id: string): boolean {
  const item = ALL_ITEMS.find((i) => i.id === id)
  return item?.addOnCents != null && item.addOnCents < item.priceCents
}

describe('itemizeQuote: the add-on engine, line by line', () => {
  it('prices a single item at full price', () => {
    expect(itemizeQuote(cart([['light-fixture', 1]]))).toEqual({
      lines: [
        {
          kind: 'item',
          id: 'light-fixture',
          name: 'Light fixture swap',
          qty: 1,
          unitCents: 11000,
          fullUnitCents: 11000,
          addOn: false,
          totalCents: 11000,
        },
      ],
      totalCents: 11000,
      family: false,
    })
  })

  it('splits extra units of the anchor item onto its add-on price', () => {
    const q = itemizeQuote(cart([['light-fixture', 3]]))
    expect(q.lines.map((l) => [l.qty, l.unitCents, l.addOn, l.totalCents])).toEqual([
      [1, 11000, false, 11000],
      [2, 5500, true, 11000],
    ])
    expect(q.totalCents).toBe(22000)
  })

  it('charges full price for one unit of the most expensive item only, whatever the order', () => {
    const a = itemizeQuote(cart([['door-knob', 2], ['ceiling-fan', 1]]))
    expect(a.lines.map((l) => [l.id, l.qty, l.unitCents, l.addOn])).toEqual([
      ['door-knob', 2, 4500, true],
      ['ceiling-fan', 1, 13500, false],
    ])
    expect(a.totalCents).toBe(13500 + 2 * 4500)
    const b = itemizeQuote(cart([['ceiling-fan', 1], ['door-knob', 2]]))
    expect(b.totalCents).toBe(a.totalCents)
  })

  it('on a tie, the first listed item carries the full price', () => {
    const q = itemizeQuote(cart([['door-fix', 1], ['door-knob', 1]]))
    expect(q.lines.map((l) => [l.id, l.unitCents, l.addOn])).toEqual([
      ['door-fix', 9500, false],
      ['door-knob', 4500, true],
    ])
  })

  it('keeps every unit of a $200+ item at full price, and it still anchors the rest', () => {
    const q = itemizeQuote(cart([['faucet-repair', 1], ['toilet-install', 2]]))
    expect(q.lines.map((l) => [l.id, l.qty, l.unitCents, l.addOn])).toEqual([
      ['faucet-repair', 1, 4500, true],
      ['toilet-install', 2, 22500, false],
    ])
    expect(q.totalCents).toBe(4500 + 2 * 22500)
  })

  it('prices Auto Maintenance at its posted price and never labels it add-on', () => {
    const q = itemizeQuote(cart([['wiper-blades', 2], ['car-battery', 1]]))
    expect(q.lines.map((l) => [l.id, l.qty, l.unitCents, l.addOn])).toEqual([
      ['wiper-blades', 2, 4500, false],
      ['car-battery', 1, 7500, false],
    ])
    expect(q.totalCents).toBe(16500)
  })

  it('leads with a bundle at its flat price and prices the items alongside it on their own', () => {
    const q = itemizeQuote(cart([['toilet-install', 1]], 1))
    expect(q.lines[0]).toEqual({
      kind: 'package',
      id: 'package-1',
      name: '#1 The Honey-Do (up to 3 small fixes)',
      qty: 1,
      unitCents: 16900,
      fullUnitCents: 16900,
      addOn: false,
      totalCents: 16900,
    })
    expect(q.totalCents).toBe(16900 + 22500)
    expect(itemizeQuote(cart([], 2)).totalCents).toBe(29900)
  })

  it('applies Forge Family to every unit price individually, bundles included', () => {
    const q = itemizeQuote(cart([['light-fixture', 2]], 1), { family: true })
    expect(q.family).toBe(true)
    expect(q.lines.map((l) => [l.id, l.qty, l.unitCents, l.fullUnitCents, l.addOn])).toEqual([
      ['package-1', 1, familyCents(16900), familyCents(16900), false],
      ['light-fixture', 1, familyCents(11000), familyCents(11000), false],
      ['light-fixture', 1, familyCents(5500), familyCents(11000), true],
    ])
    expect(q.totalCents).toBe(11500 + 7500 + 3500)
  })
})

describe('itemizeQuote agrees with the booking cart and never exceeds the menu', () => {
  // Deterministic pseudo-random carts across the whole menu (mulberry32).
  function rng(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  const rand = rng(20261017)
  const carts: Cart[] = Array.from({ length: 300 }, () => {
    const pool = [...ALL_ITEMS]
    const lineCount = 1 + Math.floor(rand() * 5)
    const items = Array.from({ length: lineCount }, () => {
      const [item] = pool.splice(Math.floor(rand() * pool.length), 1)
      return { id: item.id, qty: 1 + Math.floor(rand() * QUOTE_MAX_QTY) }
    })
    return { items, packageNumber: null }
  })

  it('totals exactly what cartTotals charges at booking, at both rates', () => {
    for (const c of carts) {
      for (const family of [false, true]) {
        expect(itemizeQuote(c, { family }).totalCents, JSON.stringify(c)).toBe(
          cartTotals(c, { family }).subtotalCents,
        )
      }
    }
  })

  it('never charges a unit above its full menu price, nor a cart above every-unit-full', () => {
    for (const c of carts) {
      for (const family of [false, true]) {
        const q = itemizeQuote(c, { family })
        for (const line of q.lines) {
          expect(line.unitCents).toBeLessThanOrEqual(line.fullUnitCents)
          expect(line.totalCents).toBe(line.unitCents * line.qty)
        }
        expect(q.totalCents).toBeLessThanOrEqual(cartTotals(c, { family }).naiveSubtotalCents)
        // Every unit of the cart is on exactly one line.
        const units = q.lines.reduce((n, l) => n + l.qty, 0)
        expect(units).toBe(c.items.reduce((n, i) => n + i.qty, 0))
        // Of the items that have a lower add-on price, at most one unit is
        // charged full: the anchor.
        const fullUnitsOfDiscountable = q.lines
          .filter((l) => !l.addOn && hasLowerAddOnPrice(l.id))
          .reduce((n, l) => n + l.qty, 0)
        expect(fullUnitsOfDiscountable).toBeLessThanOrEqual(1)
      }
    }
  })

  it('folds back into the cart it came from', () => {
    for (const c of carts.slice(0, 50)) {
      expect(cartFromQuoteLines(itemizeQuote(c).lines)).toEqual(c)
    }
    expect(cartFromQuoteLines(itemizeQuote(cart([['door-knob', 2]], 2)).lines)).toEqual(cart([['door-knob', 2]], 2))
  })
})

describe('parseQuoteCart', () => {
  it('accepts menu ids with whole quantities and a fixed-price bundle', () => {
    expect(parseQuoteCart({ items: [{ id: 'ceiling-fan', qty: 2 }], packageNumber: 1 })).toEqual({
      ok: true,
      cart: cart([['ceiling-fan', 2]], 1),
    })
    expect(parseQuoteCart({ items: [], packageNumber: 2 })).toEqual({ ok: true, cart: cart([], 2) })
    expect(parseQuoteCart({ items: [{ id: 'door-knob', qty: 1 }] })).toEqual({ ok: true, cart: cart([['door-knob', 1]]) })
  })

  it('refuses rather than drops or clamps', () => {
    const bad: [unknown, RegExp][] = [
      [null, /at least one/],
      [{ items: [] }, /at least one/],
      [{ items: 'ceiling-fan' }, /list/],
      [{ items: [{ id: 'gutter-clean', qty: 1 }] }, /Unknown menu item: gutter-clean/],
      [{ items: [{ id: 'ceiling-fan', qty: 0 }] }, /quantity must be a whole number from 1 to 10/],
      [{ items: [{ id: 'ceiling-fan', qty: 11 }] }, /from 1 to 10/],
      [{ items: [{ id: 'ceiling-fan', qty: 1.5 }] }, /whole number/],
      [{ items: [{ id: 'ceiling-fan', qty: '2' }] }, /whole number/],
      [{ items: [{ id: 'ceiling-fan', qty: 1 }, { id: 'ceiling-fan', qty: 1 }] }, /listed twice/],
      [{ items: [], packageNumber: 3 }, /priced from photos; send it as a custom amount/],
      [{ items: [], packageNumber: 9 }, /Unknown bundle/],
      [{ items: Array.from({ length: 21 }, (_, i) => ({ id: ALL_ITEMS[i].id, qty: 1 })) }, /at most 20/],
    ]
    for (const [input, error] of bad) {
      const res = parseQuoteCart(input)
      expect(res.ok, JSON.stringify(input)).toBe(false)
      expect((res as { error: string }).error).toMatch(error)
    }
  })
})

describe('planMenuQuote', () => {
  const menu = { items: [{ id: 'light-fixture', qty: 2 }], packageNumber: null }

  it('defaults the deposit to the whole total, with no balance', () => {
    expect(planMenuQuote(menu, 'Swap two fixtures')).toMatchObject({
      ok: true,
      depositCents: 16500,
      balanceCents: 0,
      quote: { totalCents: 16500, family: false },
    })
  })

  it('splits a smaller deposit so deposit + balance is the menu total', () => {
    expect(planMenuQuote(menu, '', 5000)).toMatchObject({ ok: true, depositCents: 5000, balanceCents: 11500 })
  })

  it('refuses a deposit over the total or under $1', () => {
    expect(planMenuQuote(menu, '', 16600)).toEqual({ ok: false, error: "Deposit can't be more than the $165.00 total" })
    expect(planMenuQuote(menu, '', 99)).toEqual({ ok: false, error: 'Deposit must be at least $1.00' })
    expect(planMenuQuote(menu, '', 100.5)).toEqual({ ok: false, error: 'Deposit must be at least $1.00' })
  })

  it('prices at the Forge Family rate when the job description carries the marker', () => {
    const plan = planMenuQuote(menu, '🏷️ FORGE FAMILY — 30% off applied\n\n• Light fixture swap ×2 — $75')
    expect(plan).toMatchObject({ ok: true, depositCents: 11000, quote: { family: true, totalCents: 11000 } })
  })

  it('passes validation errors through', () => {
    expect(planMenuQuote({ items: [] }, '')).toMatchObject({ ok: false, error: expect.stringMatching(/at least one/) })
  })
})

describe('isForgeFamilyJob', () => {
  it('reads the marker the booking route writes at the top of the description', () => {
    expect(isForgeFamilyJob('🏷️ FORGE FAMILY — 30% off applied\n\nPACKAGE: #1')).toBe(true)
    expect(isForgeFamilyJob('FORGE FAMILY friend of Mitch')).toBe(true)
    expect(isForgeFamilyJob('Mount a TV. FORGE FAMILY')).toBe(false)
    expect(isForgeFamilyJob('Forge family friend')).toBe(false)
    expect(isForgeFamilyJob('')).toBe(false)
    expect(isForgeFamilyJob(null)).toBe(false)
  })
})

describe('menuCartFromDescription', () => {
  it('reads back the cart a self-scheduled booking wrote, at either rate', () => {
    const c = cart([['ceiling-fan', 1], ['door-knob', 3], ['tv-standard', 1]])
    expect(menuCartFromDescription(formatCartSummary(c))).toEqual({ cart: c, unmatched: [] })
    const family = `🏷️ FORGE FAMILY — 30% off applied\n\n${formatCartSummary(c, { family: true })}\n\nNote: gate code 1234`
    expect(menuCartFromDescription(family)).toEqual({ cart: c, unmatched: [] })
  })

  it('reads a booked bundle, and reports the #3 and renamed items it cannot price', () => {
    expect(menuCartFromDescription(formatCartSummary(cart([], 2)))).toEqual({ cart: cart([], 2), unmatched: [] })
    expect(menuCartFromDescription(formatCartSummary(cart([], 3)))).toEqual({
      cart: cart([]),
      unmatched: ['#3 The Whole List'],
    })
    expect(
      menuCartFromDescription('• Gutter cleaning ×1 — $95\n• Showerhead swap ×2 — $95 first / $45 add-on\n\nEstimated: 3 items · $140 (final on site)'),
    ).toEqual({ cart: cart([['showerhead', 2]]), unmatched: ['Gutter cleaning'] })
  })

  it('returns null for a custom request with no booking summary', () => {
    expect(menuCartFromDescription('Need the deck boards replaced, about 12 of them')).toBeNull()
    expect(menuCartFromDescription('')).toBeNull()
  })
})

describe('stored lines and text', () => {
  it('reads back the lines stamped into the quote.sent payload', () => {
    const q = itemizeQuote(cart([['recaulk', 2]], 1), { family: true })
    const after = JSON.parse(JSON.stringify({ depositCents: q.totalCents, lines: q.lines, totalCents: q.totalCents, family: q.family }))
    expect(readQuotedLines(after)).toEqual(q)
  })

  it('treats custom-amount and malformed payloads as not itemized', () => {
    expect(readQuotedLines({ depositCents: 5000, balanceCents: 0 })).toBeNull()
    expect(readQuotedLines({ lines: [], totalCents: 0 })).toBeNull()
    expect(readQuotedLines({ lines: [{ id: 'x' }], totalCents: 100 })).toBeNull()
    expect(readQuotedLines(null)).toBeNull()
  })

  it('formats each line with quantity, unit price and the add-on label', () => {
    const [full, addOn] = itemizeQuote(cart([['light-fixture', 3]])).lines
    expect(formatQuoteLineText(full)).toBe('Light fixture swap — 1 × $110.00 = $110.00')
    expect(formatQuoteLineText(addOn)).toBe('Light fixture swap (add-on price) — 2 × $55.00 = $110.00')
    expect(summarizeQuoteLines(itemizeQuote(cart([['light-fixture', 3], ['door-knob', 1]], 1)).lines)).toBe(
      '#1 The Honey-Do (up to 3 small fixes) ×1, Light fixture swap ×3, Door knob replacement ×1',
    )
  })

  it('every bundle a quote can carry is a fixed-price one', () => {
    for (const pkg of SERVICE_PACKAGES) {
      expect(parseQuoteCart({ items: [], packageNumber: pkg.number }).ok).toBe(!pkg.quoteFirst)
    }
  })
})

describe('custom lines: anything off the menu, charged as entered', () => {
  const travel = { name: 'Travel fee (Benson)', qty: 1, unitCents: 3500 }

  it('follow the menu lines, priced exactly as typed, untouched by the add-on engine or Forge Family', () => {
    const q = itemizeQuote(cart([['light-fixture', 2]]), {
      family: true,
      custom: [travel, { name: 'Wire, 50 ft', qty: 2, unitCents: 1899 }],
    })
    const custom = q.lines.filter((l) => l.kind === 'custom')
    expect(custom).toEqual([
      { kind: 'custom', id: 'custom-1', name: 'Travel fee (Benson)', qty: 1, unitCents: 3500, fullUnitCents: 3500, addOn: false, totalCents: 3500 },
      { kind: 'custom', id: 'custom-2', name: 'Wire, 50 ft', qty: 2, unitCents: 1899, fullUnitCents: 1899, addOn: false, totalCents: 3798 },
    ])
    const menuOnly = itemizeQuote(cart([['light-fixture', 2]]), { family: true })
    expect(q.totalCents).toBe(menuOnly.totalCents + 3500 + 3798)
    expect(q.lines.slice(0, menuOnly.lines.length)).toEqual(menuOnly.lines)
  })

  it('make a quote on their own, with a discount and an included line', () => {
    const plan = planMenuQuote(undefined, '', undefined, [
      { name: '#3 Whole List', qty: 1, unitCents: 62900 },
      { name: 'Haul-away', qty: 1, unitCents: 0 },
      { name: 'Returning customer discount', qty: 1, unitCents: -5000 },
    ])
    expect(plan).toMatchObject({ ok: true, depositCents: 57900, balanceCents: 0 })
    if (plan.ok) expect(plan.quote.lines.map((l) => l.totalCents)).toEqual([62900, 0, -5000])
  })

  it('split into a deposit and a balance like any quote', () => {
    expect(planMenuQuote({ items: [], packageNumber: null }, '', 10000, [travel, { name: 'Deck repair', qty: 1, unitCents: 90000 }])).toMatchObject({
      ok: true,
      depositCents: 10000,
      balanceCents: 83500,
    })
  })

  it('refuse a quote that nets under $1, or one with no lines at all', () => {
    expect(planMenuQuote(undefined, '', undefined, [{ name: 'Discount', qty: 1, unitCents: -100 }])).toEqual({
      ok: false,
      error: 'The quote total is -$1.00; it must be at least $1.00.',
    })
    expect(planMenuQuote({ items: [], packageNumber: null }, '', undefined, [])).toEqual({
      ok: false,
      error: 'Add at least one line: a menu item, a bundle, or your own.',
    })
  })

  it('are validated with a reason rather than fixed up', () => {
    expect(parseCustomLines([{ name: '  Travel   fee ', qty: 3, unitCents: -250 }])).toEqual({
      ok: true,
      lines: [{ name: 'Travel fee', qty: 3, unitCents: -250 }],
    })
    expect(parseCustomLines(undefined)).toEqual({ ok: true, lines: [] })
    expect(parseCustomLines([{ name: '', qty: 1, unitCents: 100 }])).toMatchObject({ ok: false, error: expect.stringContaining('give it a name') })
    expect(parseCustomLines([{ name: 'X', qty: 0, unitCents: 100 }])).toMatchObject({ ok: false, error: expect.stringContaining('quantity') })
    expect(parseCustomLines([{ name: 'X', qty: 1.5, unitCents: 100 }])).toMatchObject({ ok: false })
    expect(parseCustomLines([{ name: 'X', qty: 1, unitCents: 12.5 }])).toMatchObject({ ok: false, error: expect.stringContaining('enter a price') })
    expect(parseCustomLines([{ name: 'X', qty: 1, unitCents: 5_000_001 }])).toMatchObject({ ok: false, error: expect.stringContaining('$50000.00') })
    expect(parseCustomLines('travel')).toMatchObject({ ok: false })
  })

  it('come back out of a sent quote for a re-quote, apart from the menu cart', () => {
    const q = itemizeQuote(cart([['door-knob', 1]]), { custom: [travel] })
    expect(customFromQuoteLines(q.lines)).toEqual([travel])
    expect(cartFromQuoteLines(q.lines)).toEqual(cart([['door-knob', 1]]))
    expect(readQuotedLines({ lines: q.lines, totalCents: q.totalCents, family: false })?.lines).toEqual(q.lines)
  })

  it('format a discount with the minus sign in front', () => {
    expect(formatCents(-2000)).toBe('-$20.00')
    expect(formatCents(1999)).toBe('$19.99')
  })
})
