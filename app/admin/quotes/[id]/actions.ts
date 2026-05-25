"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { sendQuoteEmail } from "@/lib/email/quote";
import { logger, maskEmail } from "@/lib/security/logger";
import { checkLimit } from "@/lib/security/rate-limit";
import { appendAuditRow } from "@/lib/sheet/audit-log";
import { findRowByJobId, updateRowByJobId } from "@/lib/sheet/repo";
import { createQuotePaymentLink } from "@/lib/stripe/payment-links";

export type SendQuoteResult =
  | { ok: true; paymentLinkUrl: string; expiresAt: string }
  | { ok: false; error: string };

const TIERS = new Set(["small", "medium", "large"] as const);
type Tier = "small" | "medium" | "large";

export interface SendQuoteInput {
  jobId: string;
  depositDollars: number;
  balanceDollars: number;
  tier: Tier;
  descriptionOverride?: string;
}

export async function sendQuote(input: SendQuoteInput): Promise<SendQuoteResult> {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email ?? null;
  if (!adminEmail || !isAllowlistedEmail(adminEmail)) {
    return { ok: false, error: "Not authorized" };
  }

  if (!(await checkLimit("admin-action", adminEmail)).success) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }

  if (!TIERS.has(input.tier)) {
    return { ok: false, error: "Invalid tier" };
  }
  if (!Number.isFinite(input.depositDollars) || input.depositDollars < 0) {
    return { ok: false, error: "Deposit must be a non-negative number" };
  }
  if (!Number.isFinite(input.balanceDollars) || input.balanceDollars < 0) {
    return { ok: false, error: "Balance must be a non-negative number" };
  }
  if (input.depositDollars < 1) {
    return { ok: false, error: "Deposit must be at least $1.00" };
  }

  const found = await findRowByJobId(input.jobId);
  if (!found) return { ok: false, error: "Job not found" };

  const customerEmail = found.row.email;
  const customerName = found.row.name;
  const serviceType = found.row.service_type;
  if (!customerEmail || !customerName) {
    return { ok: false, error: "Customer email or name missing on job row" };
  }

  const depositCents = Math.round(input.depositDollars * 100);
  const balanceCents = Math.round(input.balanceDollars * 100);
  const description = (input.descriptionOverride || found.row.description || serviceType).slice(0, 500);

  let paymentLink;
  try {
    paymentLink = await createQuotePaymentLink(
      {
        jobId: input.jobId,
        customerEmail,
        customerName,
        depositCents,
        balanceCents,
        tier: input.tier,
        description,
      },
      adminEmail,
    );
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "admin", action: "sendQuote", step: "createPaymentLink" },
      extra: { jobId: input.jobId },
    });
    logger.error({ err, jobId: input.jobId }, "admin: createQuotePaymentLink failed");
    const msg = err instanceof Error ? err.message : "Couldn't create Payment Link";
    return { ok: false, error: msg };
  }

  try {
    await sendQuoteEmail({
      toEmail: customerEmail,
      toName: customerName,
      serviceType,
      description,
      depositCents,
      balanceCents,
      paymentLinkUrl: paymentLink.url,
      expiresAt: paymentLink.expiresAt,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "admin", action: "sendQuote", step: "sendEmail" },
      extra: { jobId: input.jobId },
    });
    logger.error({ err, jobId: input.jobId }, "admin: sendQuoteEmail failed");
    return {
      ok: false,
      error:
        "Payment Link was created but the email failed to send. Copy the link from Stripe Dashboard and send manually.",
    };
  }

  await updateRowByJobId(input.jobId, {
    status: "Quoted",
    balance_owed_cents: String(balanceCents),
  });
  await appendAuditRow({
    actor: adminEmail,
    action: "quote.sent",
    target: input.jobId,
    after: JSON.stringify({
      paymentLinkId: paymentLink.paymentLinkId,
      depositCents,
      balanceCents,
      tier: input.tier,
      customerEmail: maskEmail(customerEmail),
    }),
  });
  logger.info(
    {
      jobId: input.jobId,
      paymentLinkId: paymentLink.paymentLinkId,
      depositCents,
      balanceCents,
      tier: input.tier,
      maskedEmail: maskEmail(customerEmail),
    },
    "admin: quote sent",
  );
  revalidatePath(`/admin/jobs/${input.jobId}`);
  revalidatePath("/admin");

  return {
    ok: true,
    paymentLinkUrl: paymentLink.url,
    expiresAt: paymentLink.expiresAt,
  };
}
