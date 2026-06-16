import { describe, it, expect } from 'vitest'
import {
  resolveCart,
  cartTotals,
  suggestPackage,
  deriveServiceCategories,
  formatCartSummary,
  isCartEmpty,
  type Cart,
} from '@/lib/cart'
import { SERVICE_MENU, SERVICE_PACKAGES } from '@/lib/constants'

// Pure unit tests for the cart logic. No mocks — the cart reads SERVICE_MENU /
// SERVICE_PACKAGES straight from constants, so the ids and numbers below are
// the real menu (e.g. 'ceiling-fan', 'faucet-replace', 'tv-standard',
// 'room-walls'). Keep these in sync with lib/constants.ts.

// Pull the real menu item so assertions don't hard-code copy that may change.
function menuItem(id: string) {
  for (const section of SERVICE_MENU) {
    const item = section.items.find((i) => i.id === id)
    if (item) return item
  }
  throw new Error(`test fixture references unknown menu id: ${id}`)
}

describe('resolveCart', () => {
  it('resolves known ids to lines carrying the menu name/price/minutes', () => {
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

describe('cartTotals', () => {
  it('sums priceCents and minutes across items × qty, excluding the package', () => {
    const fan = menuItem('ceiling-fan') // 13500 cents, 90 min
    const faucet = menuItem('faucet-replace') // 17500 cents, 120 min
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
    expect(totals.subtotalCents).toBe(fan.priceCents + faucet.priceCents * 2)
    expect(totals.minutes).toBe(fan.minutes + faucet.minutes * 2)
  })

  it('returns zeros for an empty cart', () => {
    expect(cartTotals({ items: [], packageNumber: null })).toEqual({
      itemCount: 0,
      subtotalCents: 0,
      minutes: 0,
    })
  })
})

describe('suggestPackage', () => {
  it('suggests the cheaper matching package once the cart crosses the threshold', () => {
    // faucet-replace ×2 = 35000 cents, 240 minutes. The #2 package (240 min
    // block, 32900 cents) covers the time AND costs less than à la carte.
    const cart: Cart = {
      items: [{ id: 'faucet-replace', qty: 2 }],
      packageNumber: null,
    }
    const totals = cartTotals(cart)
    expect(totals.minutes).toBeGreaterThanOrEqual(120)

    const suggestion = suggestPackage(cart)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.number).toBe(2)
    expect(suggestion!.priceCents).toBeLessThanOrEqual(totals.subtotalCents)
  })

  it('returns null for a small cart under the 120-minute threshold', () => {
    // ceiling-fan alone is 90 minutes — below the package nudge threshold.
    const cart: Cart = {
      items: [{ id: 'ceiling-fan', qty: 1 }],
      packageNumber: null,
    }
    expect(cartTotals(cart).minutes).toBeLessThan(120)
    expect(suggestPackage(cart)).toBeNull()
  })

  it('returns null when the cart is already on a package', () => {
    const cart: Cart = {
      items: [{ id: 'faucet-replace', qty: 2 }],
      packageNumber: 2,
    }
    expect(suggestPackage(cart)).toBeNull()
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
    // tv-standard (TV Mounting) and furniture (Installation & Furniture
    // Assembly) both map to the 'mounting' code — deduped to one entry.
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
