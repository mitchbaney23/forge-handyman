import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression guard for the 2026-08-22 first-job failure: the deposit Payment
// Link lacked customer_creation: 'always', so Stripe ran a GUEST checkout —
// no Customer was created, setup_future_usage had nothing to attach the card
// to, and the balance charge at Mark Complete had nothing to charge. Every
// payment link we create must force customer creation.

const created = {
  paymentLinks: [] as Record<string, unknown>[],
};

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    products: {
      create: () => Promise.resolve({ id: "prod_1" }),
    },
    prices: {
      create: () => Promise.resolve({ id: "price_1" }),
    },
    paymentLinks: {
      create: (params: Record<string, unknown>) => {
        created.paymentLinks.push(params);
        return Promise.resolve({ id: "plink_1", url: "https://buy.stripe.com/test" });
      },
    },
  }),
  buildIdempotencyKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("@/lib/data", () => ({
  appendAuditRow: () => Promise.resolve(),
}));
vi.mock("@/lib/security/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  maskEmail: (v: string | undefined) => v ?? "",
}));

import { createBalancePaymentLink, createQuotePaymentLink } from "@/lib/stripe/payment-links";

beforeEach(() => {
  created.paymentLinks = [];
});

describe("payment links save a reusable card", () => {
  it("deposit link forces customer creation and off-session card saving", async () => {
    await createQuotePaymentLink(
      {
        jobId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        customerEmail: "jane@example.com",
        customerName: "Jane Homeowner",
        depositCents: 5000,
        balanceCents: 11900,
        tier: "small",
        description: "TV mounting",
      },
      "admin@example.com",
    );
    expect(created.paymentLinks).toHaveLength(1);
    const link = created.paymentLinks[0] as {
      customer_creation?: string;
      payment_intent_data?: { setup_future_usage?: string };
    };
    expect(link.customer_creation).toBe("always");
    expect(link.payment_intent_data?.setup_future_usage).toBe("off_session");
  });

  it("balance link forces customer creation and carries the balance-link purpose", async () => {
    await createBalancePaymentLink(
      {
        jobId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        customerEmail: "jane@example.com",
        amountCents: 11900,
        serviceType: "TV mounting",
      },
      "admin@example.com",
    );
    expect(created.paymentLinks).toHaveLength(1);
    const link = created.paymentLinks[0] as {
      customer_creation?: string;
      metadata?: Record<string, string>;
      payment_intent_data?: { metadata?: Record<string, string> };
      restrictions?: { completed_sessions?: { limit?: number } };
    };
    expect(link.customer_creation).toBe("always");
    // 'balance-link' on BOTH metadata surfaces: the session metadata routes
    // the webhook away from the deposit path; the PI metadata keeps refunds
    // and audit rows attributable.
    expect(link.metadata?.purpose).toBe("balance-link");
    expect(link.payment_intent_data?.metadata?.purpose).toBe("balance-link");
    expect(link.restrictions?.completed_sessions?.limit).toBe(1);
  });
});
