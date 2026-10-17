import { beforeEach, describe, expect, it, vi } from 'vitest'

// lib/crm/quote.ts: the shared "build a quote" core behind the admin quote
// page and the MCP send_quote tool. Stripe, Gmail and the data layer are
// mocked; what is pinned is the order of operations and the side effects:
// validate, create the Payment Link under the actor, email the customer, and
// only then flip the job to Quoted, record the balance and stamp the
// quote.sent activity with the payload the lifecycle cron reads back.

const data = vi.hoisted(() => ({
  appendAuditRow: vi.fn(),
  findRowByJobId: vi.fn(),
  updateRowByJobId: vi.fn(),
}))
vi.mock('@/lib/data', () => data)
const stripe = vi.hoisted(() => ({ createQuotePaymentLink: vi.fn() }))
vi.mock('@/lib/stripe/payment-links', () => stripe)
const mail = vi.hoisted(() => ({ sendQuoteEmail: vi.fn() }))
vi.mock('@/lib/email/quote', () => mail)
vi.mock('@/lib/security/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => `masked:${e}`,
}))

import { sendQuote } from '@/lib/crm/quote'
import type { ContactRow } from '@/lib/data'

const ACTOR = 'claude:mitch'
const JOB = '11111111-2222-4333-8444-555555555555'
const LINK = { url: 'https://buy.stripe.com/test_abc', paymentLinkId: 'plink_1', expiresAt: '2026-09-27T14:00:00.000Z' }

function row(overrides: Partial<ContactRow> = {}): ContactRow {
  return {
    submitted_at: '2026-09-16T14:00:00.000Z',
    name: 'Sarah Kim',
    phone: '+19195550142',
    email: 'sarah@example.com',
    address: '412 Oak St, Garner, NC',
    service_type: 'mounting',
    preferred_date: '',
    description: 'Two TVs mounted',
    referral_source: '',
    status: 'New',
    job_id: JOB,
    ...overrides,
  }
}

const args = { jobId: JOB, depositCents: 13500, balanceCents: 22500, tier: 'medium' as const, actor: ACTOR }

beforeEach(() => {
  vi.clearAllMocks()
  data.findRowByJobId.mockResolvedValue({ rowNumber: 2, row: row() })
  stripe.createQuotePaymentLink.mockResolvedValue(LINK)
  mail.sendQuoteEmail.mockResolvedValue(undefined)
})

describe('sendQuote validation', () => {
  it('refuses bad input before touching Stripe', async () => {
    const cases = [
      { ...args, tier: 'huge' as unknown as 'small' },
      { ...args, depositCents: 99 },
      { ...args, depositCents: 100.5 },
      { ...args, depositCents: -1 },
      { ...args, balanceCents: -1 },
    ]
    for (const c of cases) {
      const res = await sendQuote(c)
      expect(res).toMatchObject({ ok: false, step: 'validate' })
    }
    data.findRowByJobId.mockResolvedValue(null)
    expect(await sendQuote(args)).toEqual({ ok: false, error: 'Job not found', step: 'validate' })
    data.findRowByJobId.mockResolvedValue({ rowNumber: 2, row: row({ email: '' }) })
    expect(await sendQuote(args)).toMatchObject({ ok: false, error: 'Customer email or name missing on job row' })
    expect(stripe.createQuotePaymentLink).not.toHaveBeenCalled()
    expect(mail.sendQuoteEmail).not.toHaveBeenCalled()
  })
})

describe('sendQuote happy path', () => {
  it('creates the link under the actor, emails it, marks Quoted and stamps quote.sent', async () => {
    const res = await sendQuote(args)
    expect(stripe.createQuotePaymentLink).toHaveBeenCalledWith(
      {
        jobId: JOB,
        customerEmail: 'sarah@example.com',
        customerName: 'Sarah Kim',
        depositCents: 13500,
        balanceCents: 22500,
        tier: 'medium',
        description: 'Two TVs mounted',
      },
      ACTOR,
    )
    expect(mail.sendQuoteEmail).toHaveBeenCalledWith({
      toEmail: 'sarah@example.com',
      toName: 'Sarah Kim',
      serviceType: 'mounting',
      description: 'Two TVs mounted',
      depositCents: 13500,
      balanceCents: 22500,
      paymentLinkUrl: LINK.url,
      expiresAt: LINK.expiresAt,
    })
    expect(data.updateRowByJobId).toHaveBeenCalledWith(JOB, { status: 'Quoted', balance_owed_cents: '22500' })
    expect(data.appendAuditRow).toHaveBeenCalledTimes(1)
    const audit = data.appendAuditRow.mock.calls[0][0]
    expect(audit).toMatchObject({ actor: ACTOR, action: 'quote.sent', target: JOB, jobId: JOB })
    // The lifecycle cron's extractQuoteMeta reads these four back.
    expect(JSON.parse(audit.after)).toEqual({
      paymentLinkId: 'plink_1',
      paymentLinkUrl: LINK.url,
      expiresAt: LINK.expiresAt,
      depositCents: 13500,
      balanceCents: 22500,
      tier: 'medium',
      customerEmail: 'masked:sarah@example.com',
    })
    expect(res).toEqual({
      ok: true,
      paymentLinkUrl: LINK.url,
      paymentLinkId: 'plink_1',
      expiresAt: LINK.expiresAt,
      depositCents: 13500,
      balanceCents: 22500,
      sentTo: 'sarah@example.com',
    })
  })

  it('uses a trimmed description override, else the job description, else the service type, capped at 500', async () => {
    await sendQuote({ ...args, description: '  Mount two TVs, hide the cables  ' })
    expect(stripe.createQuotePaymentLink.mock.calls[0][0].description).toBe('Mount two TVs, hide the cables')
    await sendQuote({ ...args, description: '   ' })
    expect(stripe.createQuotePaymentLink.mock.calls[1][0].description).toBe('Two TVs mounted')
    data.findRowByJobId.mockResolvedValue({ rowNumber: 2, row: row({ description: '' }) })
    await sendQuote(args)
    expect(stripe.createQuotePaymentLink.mock.calls[2][0].description).toBe('mounting')
    await sendQuote({ ...args, description: 'x'.repeat(600) })
    expect(stripe.createQuotePaymentLink.mock.calls[3][0].description).toHaveLength(500)
  })
})

describe('sendQuote failures', () => {
  it('stops at the payment link: no email, no status change', async () => {
    const boom = new Error('Stripe down')
    stripe.createQuotePaymentLink.mockRejectedValue(boom)
    const res = await sendQuote(args)
    expect(res).toEqual({ ok: false, error: 'Stripe down', step: 'payment_link', cause: boom })
    expect(mail.sendQuoteEmail).not.toHaveBeenCalled()
    expect(data.updateRowByJobId).not.toHaveBeenCalled()
    expect(data.appendAuditRow).not.toHaveBeenCalled()
  })

  it('stops at the email with the copy-the-link message: link exists, job untouched', async () => {
    const boom = new Error('Gmail 500')
    mail.sendQuoteEmail.mockRejectedValue(boom)
    const res = await sendQuote(args)
    expect(res).toMatchObject({ ok: false, step: 'email', cause: boom })
    expect((res as { error: string }).error).toMatch(/Copy the link from Stripe Dashboard/)
    expect(data.updateRowByJobId).not.toHaveBeenCalled()
    expect(data.appendAuditRow).not.toHaveBeenCalled()
  })
})

describe('sendQuote from the menu', () => {
  const menu = { items: [{ id: 'light-fixture', qty: 3 }, { id: 'door-knob', qty: 1 }], packageNumber: null }
  const menuArgs = { jobId: JOB, menu, tier: 'small' as const, actor: ACTOR }
  // light-fixture anchors: $110 + 2 × $55 add-on, door knob at its $45 add-on.
  const expectedLines = [
    { kind: 'item', id: 'light-fixture', name: 'Light fixture swap', qty: 1, unitCents: 11000, fullUnitCents: 11000, addOn: false, totalCents: 11000 },
    { kind: 'item', id: 'light-fixture', name: 'Light fixture swap', qty: 2, unitCents: 5500, fullUnitCents: 11000, addOn: true, totalCents: 11000 },
    { kind: 'item', id: 'door-knob', name: 'Door knob replacement', qty: 1, unitCents: 4500, fullUnitCents: 9500, addOn: true, totalCents: 4500 },
  ]

  it('prices the items itself, itemizes the link and email, and stamps the lines', async () => {
    const res = await sendQuote({ ...menuArgs, description: '  Bring the long ladder  ' })
    expect(stripe.createQuotePaymentLink).toHaveBeenCalledWith(
      {
        jobId: JOB,
        customerEmail: 'sarah@example.com',
        customerName: 'Sarah Kim',
        depositCents: 26500,
        balanceCents: 0,
        tier: 'small',
        description: 'Bring the long ladder',
        lines: [
          { name: 'Light fixture swap', unitCents: 11000, quantity: 1 },
          { name: 'Light fixture swap (add-on price)', unitCents: 5500, quantity: 2 },
          { name: 'Door knob replacement (add-on price)', unitCents: 4500, quantity: 1 },
        ],
      },
      ACTOR,
    )
    expect(mail.sendQuoteEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Bring the long ladder',
        depositCents: 26500,
        balanceCents: 0,
        lines: expectedLines,
        family: false,
      }),
    )
    expect(data.updateRowByJobId).toHaveBeenCalledWith(JOB, { status: 'Quoted', balance_owed_cents: '0' })
    const after = JSON.parse(data.appendAuditRow.mock.calls[0][0].after)
    expect(after).toMatchObject({ depositCents: 26500, balanceCents: 0, totalCents: 26500, family: false, lines: expectedLines })
    expect(res).toMatchObject({ ok: true, depositCents: 26500, balanceCents: 0, itemized: { totalCents: 26500 } })
  })

  it('does not fall back to the job description for the note; the Stripe name uses the items', async () => {
    await sendQuote(menuArgs)
    expect(mail.sendQuoteEmail.mock.calls[0][0].description).toBe('')
    expect(stripe.createQuotePaymentLink.mock.calls[0][0].description).toBe(
      'Light fixture swap ×3, Door knob replacement ×1',
    )
  })

  it('takes a smaller deposit and records the rest as the balance owed', async () => {
    const res = await sendQuote({ ...menuArgs, depositCents: 10000 })
    expect(stripe.createQuotePaymentLink.mock.calls[0][0]).toMatchObject({ depositCents: 10000, balanceCents: 16500 })
    expect(data.updateRowByJobId).toHaveBeenCalledWith(JOB, { status: 'Quoted', balance_owed_cents: '16500' })
    expect(res).toMatchObject({ ok: true, depositCents: 10000, balanceCents: 16500 })
  })

  it('prices a Forge Family job at the family rate', async () => {
    data.findRowByJobId.mockResolvedValue({
      rowNumber: 2,
      row: row({ description: '🏷️ FORGE FAMILY — 30% off applied\n\n• Light fixture swap ×3 — $75 first / $35 add-on' }),
    })
    const res = await sendQuote({ ...menuArgs, menu: { items: [{ id: 'light-fixture', qty: 3 }], packageNumber: null } })
    // $110 → $75 family, $55 add-on → $35 family.
    expect(res).toMatchObject({ ok: true, depositCents: 7500 + 2 * 3500, itemized: { family: true } })
    expect(mail.sendQuoteEmail.mock.calls[0][0].family).toBe(true)
  })

  it('refuses a bad menu, a deposit over the total, or a total that moved, before touching Stripe', async () => {
    expect(await sendQuote({ ...menuArgs, menu: { items: [{ id: 'gutters', qty: 1 }], packageNumber: null } })).toMatchObject({
      ok: false,
      step: 'validate',
      error: expect.stringMatching(/Unknown menu item/),
    })
    expect(await sendQuote({ ...menuArgs, depositCents: 26600 })).toMatchObject({
      ok: false,
      error: "Deposit can't be more than the $265.00 total",
    })
    expect(await sendQuote({ ...menuArgs, expectedTotalCents: 30000 })).toMatchObject({
      ok: false,
      step: 'validate',
      error: 'The menu prices this quote at $265.00, not $300.00. Reload and check it before sending.',
    })
    expect(stripe.createQuotePaymentLink).not.toHaveBeenCalled()
    expect(mail.sendQuoteEmail).not.toHaveBeenCalled()
    expect(await sendQuote({ ...menuArgs, expectedTotalCents: 26500 })).toMatchObject({ ok: true })
  })
})
