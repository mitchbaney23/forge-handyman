import { describe, expect, it } from 'vitest'
import { buildPaymentReceipt } from '@/lib/email/payment-receipt'

const base = { toEmail: 'jane@example.com', toName: 'Jane Doe', serviceType: 'TV mounting', amountCents: 12000, methodLabel: 'Cash', balanceAfterCents: 0, reviewAsk: false }

describe('payment receipt', () => {
  it('confirms the amount and method, and says paid in full or what is left', () => {
    const paid = buildPaymentReceipt(base)
    expect(paid.subject).toBe('Payment received: $120.00 — Forge Handyman')
    expect(paid.text).toContain('We received your Cash payment of $120.00 for TV mounting. Thank you.')
    expect(paid.text).toContain("You're paid in full.")
    expect(buildPaymentReceipt({ ...base, balanceAfterCents: 5000 }).text).toContain('Remaining balance: $50.00.')
  })

  it('carries the Google review link only when asked to', () => {
    expect(buildPaymentReceipt(base).text).not.toContain('Google review')
    const withAsk = buildPaymentReceipt({ ...base, reviewAsk: true })
    expect(withAsk.text).toContain("Thank you so much for choosing Forge! We're so happy we could help with this job.")
    expect(withAsk.text).toContain('looking to help more people in the Triangle')
    expect(withAsk.text).toContain("if there's anything more we could have done on this job")
    // One thank-you, not two, when the review block follows.
    expect(withAsk.text).toContain('We received your Cash payment of $120.00 for TV mounting.\n')
    expect(withAsk.html).toContain('Leave a Google review')
  })
})
