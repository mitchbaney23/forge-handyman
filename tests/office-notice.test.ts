import { describe, expect, it } from 'vitest'
import {
  buildPaymentNotice,
  buildQuoteSentNotice,
  buildScheduledNotice,
  senderLabel,
} from '@/lib/email/office-notice'
import { itemizeQuote } from '@/lib/quote-lines'

// lib/email/office-notice.ts: the short internal emails admin@ and operations@
// get when a quote goes out, a customer pays, or a job is scheduled. What is
// pinned: the subject says who and how much at a glance, the body carries the
// facts to check, and every notice links straight to the job.

const JOB = 'bbbbbbbb-0000-4000-8000-000000000001'

describe('quote sent notice', () => {
  it('names the customer and total, lists each line, says who sent it, and links the job', () => {
    const q = itemizeQuote(
      { items: [{ id: 'ceiling-fan', qty: 1 }], packageNumber: null },
      { custom: [{ name: 'Travel fee', qty: 1, unitCents: 3500 }] },
    )
    const n = buildQuoteSentNotice({
      jobId: JOB,
      customerName: 'Jane Doe',
      customerEmail: 'jane@example.com',
      serviceType: 'Electrical',
      depositCents: 10000,
      balanceCents: q.totalCents - 10000,
      lines: q.lines,
      expiresAt: '2026-10-24T14:00:00.000Z',
      actor: 'claude:mom',
    })
    expect(n.subject).toBe('Quote sent: Jane Doe — $170.00')
    expect(n.text).toContain('Due when they pay: $100.00')
    expect(n.text).toContain('Balance at completion: $70.00')
    expect(n.text).toContain('- Travel fee — 1 × $35.00 = $35.00')
    expect(n.text).toContain('Sent by: Claude (for mom)')
    expect(n.text).toContain(`/admin/jobs/${JOB}`)
    expect(n.html).toContain('Jane Doe &lt;jane@example.com&gt;')
  })
})

describe('payment notice', () => {
  it('a deposit says what was paid, what is left, and warns when no card was saved for the balance', () => {
    const n = buildPaymentNotice({
      jobId: JOB,
      kind: 'deposit',
      customerName: 'Jane Doe',
      customerEmail: 'jane@example.com',
      serviceType: 'TV mounting',
      amountPaidCents: 9500,
      balanceCents: 20000,
      appointmentLabel: 'Sat, Oct 24 · 9:00 AM',
      cardSaved: false,
    })
    expect(n.subject).toBe('Deposit paid: Jane Doe — $95.00')
    expect(n.text).toContain('Balance at completion: $200.00')
    expect(n.text).toContain('Scheduled: Sat, Oct 24 · 9:00 AM')
    expect(n.text).toContain("Card on file: NOT saved — Mark Complete can't charge it")
  })

  it('a deposit that covers everything says paid in full, with no card line', () => {
    const n = buildPaymentNotice({
      jobId: JOB,
      kind: 'deposit',
      customerName: 'Jane',
      customerEmail: '',
      serviceType: '',
      amountPaidCents: 24500,
      balanceCents: 0,
      cardSaved: true,
    })
    expect(n.text).toContain('Balance at completion: None — paid in full')
    expect(n.text).not.toContain('Card on file')
  })

  it('a balance link payment is paid in full', () => {
    const n = buildPaymentNotice({
      jobId: JOB,
      kind: 'balance',
      customerName: 'Nafi',
      customerEmail: 'n@example.com',
      serviceType: 'Faucet',
      amountPaidCents: 11900,
      balanceCents: 0,
      cardSaved: true,
    })
    expect(n.subject).toBe('Balance paid: Nafi — $119.00')
    expect(n.text).toContain('Balance: Paid in full')
  })
})

describe('scheduled notice', () => {
  it('gives the time, place, calendar and whether the customer was emailed', () => {
    const n = buildScheduledNotice({
      jobId: JOB,
      customerName: 'Bob',
      customerEmail: '',
      serviceType: 'Fence repair',
      address: '5 Elm Ave, Clayton',
      whenLabel: 'Tue, Oct 20, 10:00 AM–12:00 PM',
      calendar: 'operations@forgehandyman.com',
      confirmation: 'no-email',
      actor: 'admin:mitch@forgehandyman.com',
    })
    expect(n.subject).toBe('Scheduled: Bob — Tue, Oct 20, 10:00 AM–12:00 PM')
    expect(n.text).toContain('When: Tue, Oct 20, 10:00 AM–12:00 PM (Eastern)')
    expect(n.text).toContain('Where: 5 Elm Ave, Clayton')
    expect(n.text).toContain('Confirmation: Not sent — no email on file; call or text them the time')
    expect(n.text).toContain('Scheduled by: mitch@forgehandyman.com')
  })
})

describe('senderLabel', () => {
  it('reads the activity actor', () => {
    expect(senderLabel('admin:mitch@forgehandyman.com')).toBe('mitch@forgehandyman.com')
    expect(senderLabel('claude:mitch')).toBe('Claude (for mitch)')
    expect(senderLabel('claude')).toBe('Claude')
  })
})
