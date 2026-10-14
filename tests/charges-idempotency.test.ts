import { beforeEach, describe, expect, it, vi } from "vitest";

// The balance charge's Stripe idempotency key must include the amount. The
// balance can be adjusted between a failed attempt and a retry; a jobId-only
// key made Stripe reject the retry for 24h because the parameters changed.

const calls = vi.hoisted(() => ({ keys: [] as string[] }));

vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    paymentIntents: {
      create: (_params: unknown, opts: { idempotencyKey: string }) => {
        calls.keys.push(opts.idempotencyKey);
        return Promise.resolve({ id: "pi_1", status: "succeeded", latest_charge: "ch_1" });
      },
    },
  }),
  buildIdempotencyKey: (...parts: string[]) => parts.filter(Boolean).join(":"),
}));
vi.mock("@/lib/data", () => ({ appendAuditRow: () => Promise.resolve() }));
vi.mock("@/lib/security/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  maskEmail: (v: string | undefined) => v ?? "",
}));

import { chargeBalance } from "@/lib/stripe/charges";

const base = {
  jobId: "11111111-2222-4333-8444-555555555555",
  customerId: "cus_1",
  paymentMethodId: "pm_1",
  description: "balance",
  customerEmail: "kara@example.com",
};

beforeEach(() => {
  calls.keys = [];
});

describe("chargeBalance idempotency key", () => {
  it("is stable for the same amount and changes when the amount changes", async () => {
    await chargeBalance({ ...base, amountCents: 13500 }, "admin@x");
    await chargeBalance({ ...base, amountCents: 13500 }, "admin@x");
    await chargeBalance({ ...base, amountCents: 1000 }, "admin@x");
    expect(calls.keys[0]).toBe(`balance-charge:${base.jobId}:13500`);
    expect(calls.keys[1]).toBe(calls.keys[0]);
    expect(calls.keys[2]).toBe(`balance-charge:${base.jobId}:1000`);
  });
});
