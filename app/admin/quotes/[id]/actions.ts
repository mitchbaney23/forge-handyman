"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { sendQuote as sendQuoteCore, type QuoteTier } from "@/lib/crm/quote";
import { checkLimit } from "@/lib/security/rate-limit";

export type SendQuoteResult =
  | { ok: true; paymentLinkUrl: string; expiresAt: string }
  | { ok: false; error: string };

const TIERS = new Set<string>(["small", "medium", "large"]);

export interface SendQuoteInput {
  jobId: string;
  depositDollars: number;
  balanceDollars: number;
  tier: QuoteTier;
  descriptionOverride?: string;
}

// The admin side of "build a quote". The work itself (Stripe Payment Link,
// customer email, status to Quoted, quote.sent activity) lives in
// lib/crm/quote.ts and is shared with the MCP send_quote tool; this action
// owns the trust boundary: the session, the money rate limit, revalidation.
export async function sendQuote(input: SendQuoteInput): Promise<SendQuoteResult> {
  const session = await getServerSession(authOptions);
  const adminEmail = session?.user?.email ?? null;
  if (!adminEmail || !isAllowlistedEmail(adminEmail)) {
    return { ok: false, error: "Not authorized" };
  }

  // Money bucket: sending a quote creates live Stripe objects + a payment link.
  if (!(await checkLimit("admin-money", adminEmail)).success) {
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

  const result = await sendQuoteCore({
    jobId: input.jobId,
    depositCents: Math.round(input.depositDollars * 100),
    balanceCents: Math.round(input.balanceDollars * 100),
    tier: input.tier,
    description: input.descriptionOverride,
    actor: adminEmail,
  });

  if (!result.ok) {
    if (result.cause !== undefined) {
      Sentry.captureException(result.cause, {
        tags: { route: "admin", action: "sendQuote", step: result.step },
        extra: { jobId: input.jobId },
      });
    }
    return { ok: false, error: result.error };
  }

  revalidatePath(`/admin/jobs/${input.jobId}`);
  revalidatePath("/admin");

  return {
    ok: true,
    paymentLinkUrl: result.paymentLinkUrl,
    expiresAt: result.expiresAt,
  };
}
