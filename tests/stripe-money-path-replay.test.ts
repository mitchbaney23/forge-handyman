import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Money-path webhook REPLAY suite: drives the REAL route
// (app/api/webhooks/stripe/route.ts) and REAL handlers
// (lib/stripe/webhook-handlers.ts) end-to-end, with an in-memory Redis (so
// the two-phase idempotency claims behave for real) and an in-memory job
// store. This is the regression guard for the silent-failure class the
// money-path fixes closed:
//   - deposit paid -> job Booked (+ receipt),
//   - transient handler failure -> Stripe retry RECOVERS the event,
//   - duplicate delivery after success -> deduped, no double side effects,
//   - dashboard refund (no charge metadata) -> resolved via the parent PI,
//   - balance charge -> Complete + completion receipt exactly once.

// ---- In-memory Redis (claims live here; TTLs irrelevant to these paths) ----
const redisStore = new Map<string, string>();
vi.mock("@upstash/redis", () => ({
  Redis: class {
    set(key: string, value: string, opts?: { nx?: boolean }) {
      if (opts?.nx && redisStore.has(key)) return Promise.resolve(null);
      redisStore.set(key, value);
      return Promise.resolve("OK");
    }
    get(key: string) {
      return Promise.resolve(redisStore.get(key) ?? null);
    }
    del(key: string) {
      redisStore.delete(key);
      return Promise.resolve(1);
    }
  },
}));

// ---- In-memory job store -----------------------------------------------------
const jobs = new Map<string, Record<string, string>>();
const calls = {
  rowUpdates: [] as { jobId: string; patch: Record<string, string> }[],
  auditRows: [] as Record<string, unknown>[],
  depositReceipts: [] as Record<string, unknown>[],
  completionReceipts: [] as Record<string, unknown>[],
  refundsRecorded: [] as Record<string, unknown>[],
  piRetrieves: [] as string[],
  paymentsRecorded: [] as Record<string, unknown>[],
  sentryMessages: [] as string[],
};
let updateFailuresRemaining = 0;

vi.mock("@/lib/data", () => ({
  updateRowByJobId: (jobId: string, patch: Record<string, string>) => {
    if (updateFailuresRemaining > 0) {
      updateFailuresRemaining -= 1;
      return Promise.reject(new Error("transient db blip"));
    }
    const row = jobs.get(jobId);
    if (row) Object.assign(row, patch);
    calls.rowUpdates.push({ jobId, patch });
    return Promise.resolve({ updated: Boolean(row) });
  },
  findRowByJobId: (jobId: string) => {
    const row = jobs.get(jobId);
    return Promise.resolve(row ? { row, rowNumber: 2 } : null);
  },
  appendAuditRow: (entry: Record<string, unknown>) => {
    calls.auditRows.push(entry);
    return Promise.resolve();
  },
  getAppointmentByJobId: () => Promise.resolve(null),
}));
vi.mock("@/lib/data/backend", () => ({ getBackend: () => "postgres" }));
vi.mock("@/lib/data/pg/payments", () => ({
  recordPayment: (args: Record<string, unknown>) => {
    calls.paymentsRecorded.push(args);
    return Promise.resolve();
  },
  reconcileAttempt: () => Promise.resolve(),
  recordRefund: (args: Record<string, unknown>) => {
    calls.refundsRecorded.push(args);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/email/deposit-receipt", () => ({
  sendDepositReceiptEmail: (args: Record<string, unknown>) => {
    calls.depositReceipts.push(args);
    return Promise.resolve();
  },
}));
vi.mock("@/lib/email/completion-receipt", () => ({
  sendCompletionReceiptEmail: (args: Record<string, unknown>) => {
    calls.completionReceipts.push(args);
    return Promise.resolve();
  },
}));

// ---- Stripe client: constructEvent replays whatever event we queue ----------
let nextEvent: Record<string, unknown> = {};
let piMetadata: Record<string, string> = {};
vi.mock("@/lib/stripe/client", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: () => nextEvent },
    paymentIntents: {
      retrieve: (id: string) => {
        calls.piRetrieves.push(id);
        return Promise.resolve({ metadata: piMetadata, payment_method: null, customer: null });
      },
    },
    paymentMethods: { retrieve: () => Promise.resolve({ customer: null }) },
  }),
  getWebhookSecret: () => "whsec_test",
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: () => undefined,
  captureMessage: (message: string) => {
    calls.sentryMessages.push(message);
    return undefined;
  },
}));
vi.mock("@/lib/security/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  maskEmail: (v: string | undefined) => v ?? "",
}));

const JOB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "sig" },
    body: "{}",
  });
}

async function deliver(event: Record<string, unknown>): Promise<number> {
  nextEvent = event;
  const { POST } = await import("@/app/api/webhooks/stripe/route");
  const res = await POST(makeRequest());
  return res.status;
}

function checkoutEvent(eventId: string): Record<string, unknown> {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        metadata: { jobId: JOB_ID },
        amount_total: 9500,
        customer: "cus_1",
        payment_intent: "pi_deposit",
        customer_details: { email: "jane@example.com", name: "Jane" },
      },
    },
  };
}

beforeEach(() => {
  redisStore.clear();
  jobs.clear();
  jobs.set(JOB_ID, {
    job_id: JOB_ID,
    email: "jane@example.com",
    name: "Jane Homeowner",
    service_type: "TV mounting",
    status: "Quoted",
    balance_owed_cents: "20000",
    deposit_paid_cents: "",
    review_sent_at: "",
  });
  calls.rowUpdates = [];
  calls.auditRows = [];
  calls.depositReceipts = [];
  calls.completionReceipts = [];
  calls.refundsRecorded = [];
  calls.piRetrieves = [];
  calls.paymentsRecorded = [];
  calls.sentryMessages = [];
  updateFailuresRemaining = 0;
  piMetadata = {};
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("money-path replay", () => {
  it("deposit paid -> job Booked, ledger + receipt sent", async () => {
    const status = await deliver(checkoutEvent("evt_dep_1"));
    expect(status).toBe(200);
    expect(jobs.get(JOB_ID)!.status).toBe("Booked");
    expect(jobs.get(JOB_ID)!.deposit_paid_cents).toBe("9500");
    expect(calls.depositReceipts).toHaveLength(1);
    expect(calls.depositReceipts[0]).toMatchObject({
      toEmail: "jane@example.com",
      amountPaidCents: 9500,
    });
  });

  it("transient failure, then Stripe's retry RECOVERS the deposit (the old bug ate it)", async () => {
    updateFailuresRemaining = 1;
    expect(await deliver(checkoutEvent("evt_dep_2"))).toBe(500);
    expect(jobs.get(JOB_ID)!.status).toBe("Quoted"); // first delivery failed

    expect(await deliver(checkoutEvent("evt_dep_2"))).toBe(200); // retry, same event id
    expect(jobs.get(JOB_ID)!.status).toBe("Booked");
  });

  it("duplicate delivery after success is deduped — no double side effects", async () => {
    await deliver(checkoutEvent("evt_dep_3"));
    const updates = calls.rowUpdates.length;
    const receipts = calls.depositReceipts.length;

    expect(await deliver(checkoutEvent("evt_dep_3"))).toBe(200);
    expect(calls.rowUpdates).toHaveLength(updates);
    expect(calls.depositReceipts).toHaveLength(receipts);
  });

  it("dashboard refund (bare charge) resolves the job via the parent PI and flips Refunded", async () => {
    piMetadata = { jobId: JOB_ID };
    const status = await deliver({
      id: "evt_ref_1",
      type: "charge.refunded",
      data: {
        object: {
          id: "ch_1",
          metadata: {}, // dashboard refunds carry no metadata — the old bug
          payment_intent: "pi_deposit",
          refunded: true,
          amount_refunded: 9500,
        },
      },
    });
    expect(status).toBe(200);
    expect(calls.piRetrieves).toContain("pi_deposit");
    expect(jobs.get(JOB_ID)!.status).toBe("Refunded");
    expect(calls.refundsRecorded).toHaveLength(1);
    expect(calls.refundsRecorded[0]).toMatchObject({ jobId: JOB_ID, amountRefundedCents: 9500 });
  });

  it("balance charge -> Complete + completion receipt exactly once (stamp dedupes)", async () => {
    const balanceEvent = (id: string) => ({
      id,
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: "pi_balance",
          metadata: { jobId: JOB_ID, purpose: "balance-charge" },
          amount: 20000,
          latest_charge: "ch_bal",
        },
      },
    });

    expect(await deliver(balanceEvent("evt_bal_1"))).toBe(200);
    expect(jobs.get(JOB_ID)!.status).toBe("Complete");
    expect(calls.completionReceipts).toHaveLength(1);
    expect(jobs.get(JOB_ID)!.review_sent_at).not.toBe("");

    // A later re-delivery under a NEW event id (post-TTL world): status write
    // is idempotent and the review_sent_at stamp blocks a second receipt.
    expect(await deliver(balanceEvent("evt_bal_2"))).toBe(200);
    expect(calls.completionReceipts).toHaveLength(1);
  });

  // The 2026-08-22 first-job failure class: a deposit checkout that produced
  // no Stripe Customer left the job with an unusable payment method and a
  // silently uncollectable balance.
  it("deposit checkout WITHOUT a customer raises the no-saved-card alarm", async () => {
    const event = checkoutEvent("evt_dep_guest");
    (event.data as { object: { customer: string | null } }).object.customer = null;
    expect(await deliver(event)).toBe(200);
    expect(jobs.get(JOB_ID)!.status).toBe("Booked"); // booking itself still works
    expect(
      calls.sentryMessages.some((m) => m.includes("without a Customer")),
    ).toBe(true);
  });

  it("balance link paid -> balance zeroed, deposit fields untouched, paid-in-full receipt", async () => {
    // A completed job whose balance couldn't be charged at Mark Complete.
    jobs.set(JOB_ID, {
      job_id: JOB_ID,
      email: "jane@example.com",
      name: "Jane Homeowner",
      service_type: "TV mounting",
      status: "Complete",
      complete_date: "2026-08-22T20:33:02.401Z",
      balance_owed_cents: "11900",
      deposit_paid_cents: "5000",
      stripe_customer_id: "",
      stripe_payment_method_id: "pm_guest_single_use",
      review_sent_at: "2026-08-22T20:33:03.106Z",
    });

    const status = await deliver({
      id: "evt_bal_link_1",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_bal_link",
          metadata: { jobId: JOB_ID, purpose: "balance-link" },
          amount_total: 11900,
          customer: "cus_new",
          payment_intent: "pi_bal_link",
          customer_details: { email: "jane@example.com", name: "Jane" },
        },
      },
    });
    expect(status).toBe(200);

    const row = jobs.get(JOB_ID)!;
    expect(row.balance_owed_cents).toBe("0");
    expect(row.status).toBe("Complete");
    // The deposit-path bug this guards against: re-Booking the job and
    // overwriting deposit_paid_cents with the balance amount.
    expect(row.deposit_paid_cents).toBe("5000");
    expect(row.complete_date).toBe("2026-08-22T20:33:02.401Z");
    expect(row.stripe_customer_id).toBe("cus_new");
    // The card fields update as a pair: with no payment method resolvable in
    // this delivery, the stale guest PM must not survive next to cus_new.
    expect(row.stripe_payment_method_id).toBe("");

    expect(calls.depositReceipts).toHaveLength(0);
    expect(calls.completionReceipts).toHaveLength(1);
    expect(calls.completionReceipts[0]).toMatchObject({
      balanceChargedCents: 11900,
      balanceOwedCents: 0,
    });
    expect(calls.paymentsRecorded).toHaveLength(1);
    expect(calls.paymentsRecorded[0]).toMatchObject({
      jobId: JOB_ID,
      purpose: "balance-link",
      amountCents: 11900,
    });
  });
});
