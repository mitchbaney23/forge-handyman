import type { Cart } from '@/lib/cart'
import { appendAuditRow, findRowByJobId, updateRowByJobId } from '@/lib/data'
import { ACTIONS } from '@/lib/data/activity-actions'
import { sendQuoteSentNotice } from '@/lib/email/office-notice'
import { sendQuoteEmail } from '@/lib/email/quote'
import {
  MIN_DEPOSIT_CENTS,
  formatCents,
  parseCustomLines,
  parseQuoteCart,
  planMenuQuote,
  quoteLineLabel,
  summarizeQuoteLines,
  type CustomLineInput,
  type ItemizedQuote,
} from '@/lib/quote-lines'
import { logger, maskEmail } from '@/lib/security/logger'
import { createQuotePaymentLink } from '@/lib/stripe/payment-links'

// ---------------------------------------------------------------------------
// The quote CORE — framework-free, actor-parameterized, like lib/crm/mutations.
//
// "Build a quote" in this business means: create a Stripe Payment Link for the
// deposit (card saved for the balance), email it to the customer, flip the job
// to Quoted and stamp the quote.sent activity the lifecycle cron reads back.
// A quote is a list of lines (lib/quote-lines.ts): menu items + quantities
// and a bundle, priced here by the add-on engine (the caller never supplies a
// menu price), plus custom lines the sender typed (travel fee, materials, a
// discount), charged as entered. A bare deposit + balance with no lines is
// still accepted for older callers.
// Both callers run exactly this code:
//   - the admin quote page (app/admin/quotes/[id]/actions.ts), actor
//     `admin:<email>`, which wraps it with the session check, the admin-money
//     rate limit and revalidatePath;
//   - the MCP send_quote tool (lib/mcp/tools.ts), actor `claude:<label>`, which
//     wraps it with the bearer token, both rate limits and a status guard.
// Therefore this module must NOT import next/* or touch the session.
// ---------------------------------------------------------------------------

export const QUOTE_TIERS = ['small', 'medium', 'large'] as const
export type QuoteTier = (typeof QUOTE_TIERS)[number]

// What the quote email shows the customer; also the Stripe product name.
export const QUOTE_DESCRIPTION_MAX = 500
export { MIN_DEPOSIT_CENTS }

interface SendQuoteBase {
  jobId: string
  tier: QuoteTier
  // Bare amount: overrides the job's own description in the email; empty or
  // whitespace falls back to the job description, then the service type.
  // Itemized: an optional note shown above the lines (no fallback — the job
  // description would repeat the booking summary the lines replace).
  description?: string
  actor: string
}

export type SendQuoteArgs = SendQuoteBase &
  (
    | { menu?: undefined; customLines?: undefined; depositCents: number; balanceCents: number }
    | {
        // Menu items + quantities and at most one bundle (may be empty when
        // there are custom lines). Re-validated (parseQuoteCart) and priced
        // here at the job's rate (Forge Family when it applies) — callers pass
        // ids and quantities, never menu prices.
        menu: Cart
        // Lines the sender typed, charged as entered (parseCustomLines).
        customLines?: CustomLineInput[]
        // Defaults to the whole quote total; the rest becomes the balance.
        depositCents?: number
        // The total the sender was shown. When given and the quote now prices
        // differently, nothing is sent.
        expectedTotalCents?: number
        balanceCents?: undefined
      }
  )

export type SendQuoteStep = 'validate' | 'payment_link' | 'email'

export type SendQuoteResult =
  | {
      ok: true
      paymentLinkUrl: string
      paymentLinkId: string
      expiresAt: string
      depositCents: number
      balanceCents: number
      sentTo: string
      // Itemized quotes only.
      itemized?: ItemizedQuote
    }
  | { ok: false; error: string; step: SendQuoteStep; cause?: unknown }

function refuse(error: string): SendQuoteResult {
  return { ok: false, error, step: 'validate' }
}

export async function sendQuote(args: SendQuoteArgs): Promise<SendQuoteResult> {
  const { jobId, tier, actor } = args

  if (!QUOTE_TIERS.includes(tier)) return refuse('Invalid tier')
  if (args.menu !== undefined) {
    const custom = parseCustomLines(args.customLines)
    if (!custom.ok) return refuse(custom.error)
    const parsed = parseQuoteCart(args.menu, { allowEmpty: custom.lines.length > 0 })
    if (!parsed.ok) return refuse(parsed.error)
  } else {
    if (!Number.isInteger(args.depositCents) || args.depositCents < 0) {
      return refuse('Deposit must be a non-negative whole number of cents')
    }
    if (!Number.isInteger(args.balanceCents) || args.balanceCents < 0) {
      return refuse('Balance must be a non-negative whole number of cents')
    }
    if (args.depositCents < MIN_DEPOSIT_CENTS) return refuse('Deposit must be at least $1.00')
  }

  const found = await findRowByJobId(jobId)
  if (!found) return refuse('Job not found')

  const customerEmail = found.row.email
  const customerName = found.row.name
  const serviceType = found.row.service_type
  if (!customerEmail || !customerName) {
    return refuse('Customer email or name missing on job row')
  }

  let depositCents: number
  let balanceCents: number
  let itemized: ItemizedQuote | undefined
  // What the email shows above the amounts.
  let note: string
  // The scope string the Stripe product and the idempotency hash use.
  let description: string
  if (args.menu !== undefined) {
    const plan = planMenuQuote(args.menu, found.row.description, args.depositCents, args.customLines)
    if (!plan.ok) return refuse(plan.error)
    if (args.expectedTotalCents != null && args.expectedTotalCents !== plan.quote.totalCents) {
      return refuse(
        `This quote now prices at ${formatCents(plan.quote.totalCents)}, not ${formatCents(args.expectedTotalCents)}. Reload and check it before sending.`,
      )
    }
    ;({ depositCents, balanceCents } = plan)
    itemized = plan.quote
    note = (args.description ?? '').trim().slice(0, QUOTE_DESCRIPTION_MAX)
    description = (note || summarizeQuoteLines(itemized.lines)).slice(0, QUOTE_DESCRIPTION_MAX)
  } else {
    ;({ depositCents, balanceCents } = args)
    description = ((args.description ?? '').trim() || found.row.description || serviceType).slice(
      0,
      QUOTE_DESCRIPTION_MAX,
    )
    note = description
  }

  let paymentLink
  try {
    paymentLink = await createQuotePaymentLink(
      {
        jobId,
        customerEmail,
        customerName,
        depositCents,
        balanceCents,
        tier,
        description,
        ...(itemized
          ? {
              lines: itemized.lines.map((line) => ({
                name: quoteLineLabel(line),
                unitCents: line.unitCents,
                quantity: line.qty,
              })),
            }
          : {}),
      },
      actor,
    )
  } catch (err) {
    logger.error({ err, jobId, actor }, 'quote: createQuotePaymentLink failed')
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't create Payment Link",
      step: 'payment_link',
      cause: err,
    }
  }

  try {
    await sendQuoteEmail({
      toEmail: customerEmail,
      toName: customerName,
      serviceType,
      description: note,
      depositCents,
      balanceCents,
      paymentLinkUrl: paymentLink.url,
      expiresAt: paymentLink.expiresAt,
      ...(itemized ? { lines: itemized.lines, family: itemized.family } : {}),
    })
  } catch (err) {
    logger.error({ err, jobId, actor }, 'quote: sendQuoteEmail failed')
    return {
      ok: false,
      error:
        'Payment Link was created but the email failed to send. Copy the link from Stripe Dashboard and send manually.',
      step: 'email',
      cause: err,
    }
  }

  await updateRowByJobId(jobId, {
    status: 'Quoted',
    balance_owed_cents: String(balanceCents),
  })
  await appendAuditRow({
    actor,
    action: ACTIONS.QUOTE_SENT,
    target: jobId,
    jobId,
    after: JSON.stringify({
      paymentLinkId: paymentLink.paymentLinkId,
      // The lifecycle cron's quote-nudge check and the owner digest read these
      // back from the activity payload (there are no quote columns on the row).
      paymentLinkUrl: paymentLink.url,
      expiresAt: paymentLink.expiresAt,
      depositCents,
      balanceCents,
      tier,
      customerEmail: maskEmail(customerEmail),
      // Itemized quotes: what was quoted, line by line (readQuotedLines reads
      // it back for the job page and preview_quote).
      ...(itemized
        ? { lines: itemized.lines, totalCents: itemized.totalCents, family: itemized.family }
        : {}),
    }),
  })
  // Tell the office (admin@ + operations@) the quote went out. Best-effort:
  // the customer already has the quote, so a failed notice must not turn a
  // sent quote into an error.
  try {
    await sendQuoteSentNotice({
      jobId,
      customerName,
      customerEmail,
      serviceType,
      depositCents,
      balanceCents,
      lines: itemized?.lines,
      expiresAt: paymentLink.expiresAt,
      actor,
    })
  } catch (err) {
    logger.warn({ err, jobId, actor }, 'quote: office notice failed (non-fatal)')
  }

  logger.info(
    {
      jobId,
      actor,
      paymentLinkId: paymentLink.paymentLinkId,
      depositCents,
      balanceCents,
      tier,
      lineCount: itemized?.lines.length ?? 0,
      maskedEmail: maskEmail(customerEmail),
    },
    'quote: sent',
  )

  return {
    ok: true,
    paymentLinkUrl: paymentLink.url,
    paymentLinkId: paymentLink.paymentLinkId,
    expiresAt: paymentLink.expiresAt,
    depositCents,
    balanceCents,
    sentTo: customerEmail,
    ...(itemized ? { itemized } : {}),
  }
}
