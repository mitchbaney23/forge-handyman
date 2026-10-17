import { beforeEach, describe, expect, it, vi } from "vitest";

// Regression guard for the 2026-08-22 first-job failure: the deposit Payment
// Link lacked customer_creation: 'always', so Stripe ran a GUEST checkout —
// no Customer was created, setup_future_usage had nothing to attach the card
// to, and the balance charge at Mark Complete had nothing to charge. Every
// payment link we create must force customer creation.

const created = {
  paymentLinks: [] as Record<string, unknown>[],
  updates: [] as { id: string; params: Record<string, unknown> }[],
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
      update: (id: string, params: Record<string, unknown>) => {
        created.updates.push({ id, params });
        if (id === "plink_broken") return Promise.reject(new Error("No such payment link"));
        return Promise.resolve({ id, active: false });
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

import {
  createBalancePaymentLink,
  createQuotePaymentLink,
  deactivatePaymentLinks,
  itemizedLinkLineItems,
  quoteContentHash,
} from "@/lib/stripe/payment-links";

beforeEach(() => {
  created.paymentLinks = [];
  created.updates = [];
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

describe("deactivatePaymentLinks", () => {
  it("switches each link off and does nothing for an empty list", async () => {
    await deactivatePaymentLinks([], "admin@x");
    expect(created.updates).toEqual([]);
    await deactivatePaymentLinks(["plink_a", "plink_b"], "admin@x");
    expect(created.updates).toEqual([
      { id: "plink_a", params: { active: false } },
      { id: "plink_b", params: { active: false } },
    ]);
  });

  it("throws when Stripe refuses, so the caller can keep the old balance", async () => {
    await expect(deactivatePaymentLinks(["plink_broken"], "admin@x")).rejects.toThrow("No such payment link");
  });
});

describe("menu quotes on the Stripe checkout page", () => {
  const JOB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const lines = [
    { name: "Light fixture swap", unitCents: 11000, quantity: 1 },
    { name: "Light fixture swap (add-on price)", unitCents: 5500, quantity: 2 },
  ];
  const quote = {
    jobId: JOB,
    customerEmail: "jane@example.com",
    customerName: "Jane",
    depositCents: 22000,
    balanceCents: 0,
    tier: "small" as const,
    description: "Light fixture swap ×3",
    lines,
  };

  it("lists each quoted line with its quantity and unit price when the link collects the whole total", async () => {
    await createQuotePaymentLink(quote, "admin:test");
    const link = created.paymentLinks[0];
    expect(link.line_items).toEqual([
      {
        price_data: {
          currency: "usd",
          unit_amount: 11000,
          product_data: { name: "Light fixture swap", metadata: { jobId: JOB } },
        },
        quantity: 1,
      },
      {
        price_data: {
          currency: "usd",
          unit_amount: 5500,
          product_data: { name: "Light fixture swap (add-on price)", metadata: { jobId: JOB } },
        },
        quantity: 2,
      },
    ]);
    // Same card-saving setup as every deposit link.
    expect(link.customer_creation).toBe("always");
    expect(link.payment_intent_data).toMatchObject({ setup_future_usage: "off_session" });
  });

  it("stays a single deposit line when a balance is left for completion, or the lines do not add up", () => {
    expect(itemizedLinkLineItems({ ...quote, depositCents: 10000, balanceCents: 12000 })).toBeNull();
    expect(itemizedLinkLineItems({ ...quote, depositCents: 21000 })).toBeNull();
    expect(itemizedLinkLineItems({ ...quote, lines: undefined })).toBeNull();
    expect(itemizedLinkLineItems({ ...quote, lines: [] })).toBeNull();
  });

  it("stays a single line when a quote has a discount or an included $0 line Stripe can't sell", () => {
    const discount = { name: "Discount", unitCents: -2000, quantity: 1 };
    expect(
      itemizedLinkLineItems({ ...quote, depositCents: 20000, lines: [...lines, discount] }),
    ).toBeNull();
    const included = { name: "Haul-away", unitCents: 0, quantity: 1 };
    expect(itemizedLinkLineItems({ ...quote, lines: [...lines, included] })).toBeNull();
    const travel = { name: "Travel fee", unitCents: 3500, quantity: 1 };
    expect(
      itemizedLinkLineItems({ ...quote, depositCents: 25500, lines: [...lines, travel] }),
    ).toHaveLength(3);
  });

  it("uses the single deposit price for a deposit-only menu quote", async () => {
    await createQuotePaymentLink({ ...quote, depositCents: 10000, balanceCents: 12000 }, "admin:test");
    expect(created.paymentLinks[0].line_items).toEqual([{ price: "price_1", quantity: 1 }]);
  });

  it("changes the idempotency hash when the lines change, and leaves custom quotes' hash alone", () => {
    const { lines: _lines, ...custom } = quote;
    void _lines;
    expect(quoteContentHash(quote)).not.toBe(quoteContentHash(custom));
    expect(quoteContentHash({ ...custom, lines: [] })).toBe(quoteContentHash(custom));
    expect(quoteContentHash(quote)).not.toBe(
      quoteContentHash({ ...quote, lines: [{ ...lines[0], name: "Door knob replacement" }, lines[1]] }),
    );
  });
});
