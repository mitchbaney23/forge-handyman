import { describe, expect, it } from 'vitest'
import { buildQuoteHtml, buildQuoteText, type QuoteEmailInput } from '@/lib/email/quote'
import { itemizeQuote } from '@/lib/quote-lines'

// lib/email/quote.ts: what the customer reads. A menu quote lists every line
// (quantity, unit price, whether it is the add-on price) and the total; a
// custom quote keeps the deposit / balance / total-estimate layout.

const base: QuoteEmailInput = {
  toEmail: 'sarah@example.com',
  toName: 'Sarah Kim',
  serviceType: 'mounting',
  description: '',
  depositCents: 0,
  balanceCents: 0,
  paymentLinkUrl: 'https://buy.stripe.com/test_abc',
  expiresAt: '2026-10-24T14:00:00.000Z',
}

const menu = itemizeQuote({
  items: [
    { id: 'tv-standard', qty: 2 },
    { id: 'soundbar', qty: 1 },
  ],
  packageNumber: null,
})

describe('menu quote email', () => {
  const paidInFull = { ...base, depositCents: menu.totalCents, lines: menu.lines, family: false }

  it('lists each line with quantity, unit price, amount and the add-on label, then the total', () => {
    const text = buildQuoteText(paidInFull)
    expect(text).toContain('TV up to 60" (existing outlet) — 1 × $135.00 = $135.00')
    expect(text).toContain('TV up to 60" (existing outlet) (add-on price) — 1 × $65.00 = $65.00')
    expect(text).toContain('Soundbar mount (add-on price) — 1 × $45.00 = $45.00')
    expect(text).toContain('Total: $245.00')
    expect(text).toContain('The highest-priced item is at full price. Each additional item is at its add-on price.')
    expect(text).toContain('Due today: $245.00')
    expect(text).toContain('Pay & book the date: https://buy.stripe.com/test_abc')
    expect(text).not.toContain('balance auto-charges')
    expect(text).not.toContain('Forge Family')

    const html = buildQuoteHtml(paidInFull)
    expect(html).toContain('TV up to 60&quot; (existing outlet)')
    expect(html.match(/Add-on price<\/div>/g)).toHaveLength(2)
    expect(html).toContain('$245.00')
    expect(html).toContain('Pay &amp; book the date')
    expect(html).not.toContain('Total estimate')
  })

  it('shows a deposit and balance when only part is due now', () => {
    const split = { ...paidInFull, depositCents: 10000, balanceCents: menu.totalCents - 10000 }
    const text = buildQuoteText(split)
    expect(text).toContain('Total: $245.00')
    expect(text).toContain('Deposit (due today):     $100.00')
    expect(text).toContain('Balance (on completion): $145.00')
    expect(text).toContain('balance auto-charges')
    expect(buildQuoteHtml(split)).toContain('Pay deposit &amp; book the date')
  })

  it('notes the Forge Family rate and an optional note above the items', () => {
    const family = itemizeQuote({ items: [{ id: 'soundbar', qty: 1 }], packageNumber: null }, { family: true })
    const input = { ...base, description: 'Bring the long ladder', depositCents: family.totalCents, lines: family.lines, family: true }
    const text = buildQuoteText(input)
    expect(text).toContain('Bring the long ladder')
    expect(text).toContain('Forge Family rate: 30% off menu prices.')
    expect(text).toContain('Soundbar mount — 1 × $65.00 = $65.00')
    expect(buildQuoteHtml(input)).toContain('Forge Family rate: 30% off menu prices.')
  })
})

describe('custom quote email', () => {
  it('keeps the deposit / balance / total-estimate layout and the scope text', () => {
    const custom = { ...base, description: 'Replace 12 deck boards', depositCents: 15000, balanceCents: 35000 }
    const text = buildQuoteText(custom)
    expect(text).toContain('Replace 12 deck boards')
    expect(text).toContain('Deposit (due today):    $150.00')
    expect(text).toContain('Total estimate:          $500.00')
    expect(text).toContain('Pay deposit & book the date')
    const html = buildQuoteHtml(custom)
    expect(html).toContain('Total estimate')
    expect(html).not.toContain('Add-on price')
  })
})

describe('custom lines in the quote email', () => {
  it('lists them like any line, a discount with its minus sign, and drops the family note when no menu price applies', () => {
    const q = itemizeQuote(
      { items: [], packageNumber: null },
      {
        family: true,
        custom: [
          { name: 'Deck boards, replace 6', qty: 1, unitCents: 48000 },
          { name: 'Friends discount', qty: 1, unitCents: -3000 },
        ],
      },
    )
    const data = { ...base, depositCents: q.totalCents, lines: q.lines, family: true }
    const text = buildQuoteText(data)
    expect(text).toContain('Deck boards, replace 6 — 1 × $480.00 = $480.00')
    expect(text).toContain('Friends discount — 1 × -$30.00 = -$30.00')
    expect(text).toContain('Total: $450.00')
    expect(text).not.toContain('Forge Family rate')
    expect(buildQuoteHtml(data)).not.toContain('Forge Family rate')
  })

  it('keeps the family note when menu lines sit beside custom ones', () => {
    const q = itemizeQuote(
      { items: [{ id: 'door-knob', qty: 1 }], packageNumber: null },
      { family: true, custom: [{ name: 'Travel fee', qty: 1, unitCents: 2500 }] },
    )
    expect(buildQuoteText({ ...base, depositCents: q.totalCents, lines: q.lines, family: true })).toContain('Forge Family rate')
  })
})
