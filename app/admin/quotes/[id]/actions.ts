"use server";

import { revalidatePath } from "next/cache";
import { getServerSession } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import type { Cart } from "@/lib/cart";
import {
  sendQuote as sendQuoteCore,
  type QuoteTier,
  type SendQuoteArgs,
} from "@/lib/crm/quote";
import { checkLimit } from "@/lib/security/rate-limit";

export type SendQuoteResult =
  | { ok: true; paymentLinkUrl: string; expiresAt: string }
  | { ok: false; error: string };

const TIERS = new Set<string>(["small", "medium", "large"]);

interface SendQuoteInputBase {
  jobId: string;
  tier: QuoteTier;
  descriptionOverride?: string;
}

export type SendQuoteInput = SendQuoteInputBase &
  (
    | { mode: "custom"; depositDollars: number; balanceDollars: number }
    | {
        // Built from the flat-rate menu: ids + quantities only. The core
        // re-prices them; expectedTotalCents is the total the composer showed,
        // so a menu change between page load and send stops the send.
        mode: "menu";
        menu: Cart;
        // Omitted = collect the whole total now.
        depositDollars?: number;
        expectedTotalCents: number;
      }
  );

// The admin side of "build a quote". The work itself (pricing a menu quote,
// Stripe Payment Link, customer email, status to Quoted, quote.sent activity)
// lives in lib/crm/quote.ts and is shared with the MCP send_quote tool; this
// action owns the trust boundary: the session, the money rate limit,
// revalidation.
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

  let args: SendQuoteArgs;
  if (input.mode === "menu") {
    if (
      input.depositDollars !== undefined &&
      (!Number.isFinite(input.depositDollars) || input.depositDollars < 1)
    ) {
      return { ok: false, error: "Deposit must be at least $1.00" };
    }
    if (!Number.isInteger(input.expectedTotalCents)) {
      return { ok: false, error: "Reload the page and check the quote before sending." };
    }
    args = {
      jobId: input.jobId,
      tier: input.tier,
      description: input.descriptionOverride,
      actor: adminEmail,
      menu: input.menu,
      depositCents:
        input.depositDollars !== undefined
          ? Math.round(input.depositDollars * 100)
          : undefined,
      expectedTotalCents: input.expectedTotalCents,
    };
  } else {
    if (!Number.isFinite(input.depositDollars) || input.depositDollars < 0) {
      return { ok: false, error: "Deposit must be a non-negative number" };
    }
    if (!Number.isFinite(input.balanceDollars) || input.balanceDollars < 0) {
      return { ok: false, error: "Balance must be a non-negative number" };
    }
    if (input.depositDollars < 1) {
      return { ok: false, error: "Deposit must be at least $1.00" };
    }
    args = {
      jobId: input.jobId,
      tier: input.tier,
      description: input.descriptionOverride,
      actor: adminEmail,
      depositCents: Math.round(input.depositDollars * 100),
      balanceCents: Math.round(input.balanceDollars * 100),
    };
  }

  const result = await sendQuoteCore(args);

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
