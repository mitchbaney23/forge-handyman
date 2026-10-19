import { describe, expect, it } from 'vitest'
import { buildPaymentReceipt } from '@/lib/email/payment-receipt'

const base = { toEmail: 'jane@example.com', toName: 'Jane Doe', serviceType: 'TV mounting', amountCents: 12000, methodLabel: 'Cash', balanceAfterCents: 0, reviewAsk: false }

describe('payment receipt', () => {
  it('confirms the amount and method, and says paid in full or what is left', () => {
    const paid = buildPaymentReceipt(base)
    expect(paid.subject).toBe('Payment received: $120.00 — Forge Handyman')
    expect(paid.text).toContain('We received your Cash payment of $120.00 for TV mounting.')
    expect(paid.text).toContain("You're paid in full.")
    expect(buildPaymentReceipt({ ...base, balanceAfterCents: 5000 }).text).toContain('Remaining balance: $50.00.')
  })

  it('carries the Google review link only when asked to', () => {
    expect(buildPaymentReceipt(base).text).not.toContain('Google review')
    const withAsk = buildPaymentReceipt({ ...base, reviewAsk: true })
    expect(withAsk.text).toContain('a quick Google review makes a real difference')
    expect(withAsk.html).toContain('Leave a Google review')
  })
})
