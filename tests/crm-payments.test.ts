import { beforeEach, describe, expect, it, vi } from "vitest";

// Recording a payment taken outside Stripe (lib/crm/payments.ts). The data
// layer, Stripe and email are mocked; what is pinned:
//   - the ledger row is purpose "manual" with the method in its data, so it
//     counts toward Total spent and revenue;
//   - a first payment on an unbooked job is the deposit (-> Booked), the
//     balance left defaults to the quote total minus what was paid;
//   - close-out marks Complete only with nothing owed, and the receipt then
//     carries the Google review ask (stamped so the cron won't ask again);
//   - every emailed Stripe link is switched off; a failure there or in any
//     email never undoes the payment.

const data = vi.hoisted(() => ({
  appendAuditRow: vi.fn(),
  findRowByJobId: vi.fn(),
  getAppointmentByJobId: vi.fn(),
  listActivitiesForJob: vi.fn(),
  updateRowByJobId: vi.fn(),
}));
const ledger = vi.hoisted(() => ({ recordPayment: vi.fn() }));
const links = vi.hoisted(() => ({ deactivatePaymentLinks: vi.fn() }));
const office = vi.hoisted(() => ({ sendPaymentNotice: vi.fn() }));
const receipt = vi.hoisted(() => ({ sendPaymentReceiptEmail: vi.fn() }));

vi.mock("@/lib/data", () => data);
vi.mock("@/lib/data/backend", () => ({ getBackend: () => "postgres" }));
vi.mock("@/lib/data/pg/payments", () => ledger);
vi.mock("@/lib/stripe/payment-links", () => links);
vi.mock("@/lib/email/office-notice", () => office);
vi.mock("@/lib/email/payment-receipt", () => receipt);
vi.mock("@/lib/security/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { recordManualPayment } from "@/lib/crm/payments";

const ACTOR = "admin:owner@forge.test";
const JOB = "bbbbbbbb-0000-4000-8000-000000000001";

function row(overrides: Record<string, string> = {}) {
  return {
    status: "Quoted",
    name: "Jane Doe",
    email: "jane@example.com",
    service_type: "TV mounting",
    deposit_paid_cents: "",
    balance_owed_cents: "0",
    review_sent_at: "",
    review_send_count: "",
    opt_out: "",
    complete_date: "",
    ...overrides,
  };
}

const quoteSent = {
  action: "quote.sent",
  at: "2026-10-15T12:00:00.000Z",
  data: { after: { paymentLinkId: "plink_quote", depositCents: 20000, balanceCents: 10000 } },
};
const balanceLink = { action: "balance_link.created", at: "2026-10-16T12:00:00.000Z", data: { after: { paymentLinkId: "plink_bal" } } };

beforeEach(() => {
  vi.clearAllMocks();
  data.findRowByJobId.mockResolvedValue({ row: row() });
  data.listActivitiesForJob.mockResolvedValue([quoteSent]);
  data.updateRowByJobId.mockResolvedValue({ updated: true });
  data.appendAuditRow.mockResolvedValue(undefined);
  data.getAppointmentByJobId.mockResolvedValue(null);
  ledger.recordPayment.mockResolvedValue(undefined);
  links.deactivatePaymentLinks.mockResolvedValue(undefined);
  office.sendPaymentNotice.mockResolvedValue(undefined);
  receipt.sendPaymentReceiptEmail.mockResolvedValue(undefined);
});

describe("recordManualPayment", () => {
  it("records a cash deposit on a quoted job: ledger, Booked, balance from the quote, links off, receipt, office", async () => {
    const res = await recordManualPayment({ jobId: JOB, amountCents: 20000, method: "cash", actor: ACTOR });

    expect(res).toMatchObject({ ok: true, kind: "deposit", balanceAfterCents: 10000, statusAfter: "Booked", closedOut: false, linksClosed: 1, receipt: "sent", reviewRequested: false });
    expect(ledger.recordPayment).toHaveBeenCalledWith({
      jobId: JOB,
      purpose: "manual",
      status: "succeeded",
      amountCents: 20000,
      data: { method: "cash", kind: "deposit", actor: ACTOR },
    });
    expect(data.updateRowByJobId).toHaveBeenCalledWith(JOB, {
      balance_owed_cents: "10000",
      deposit_paid_cents: "20000",
      status: "Booked",
    });
    expect(links.deactivatePaymentLinks).toHaveBeenCalledWith(["plink_quote"], ACTOR);
    expect(receipt.sendPaymentReceiptEmail).toHaveBeenCalledWith(
      expect.objectContaining({ amountCents: 20000, methodLabel: "Cash", balanceAfterCents: 10000, reviewAsk: false }),
    );
    expect(office.sendPaymentNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "deposit",
        amountPaidCents: 20000,
        balanceCents: 10000,
        recorded: expect.objectContaining({ methodLabel: "Cash", statusAfter: "Booked", linksClosed: 1, receipt: "sent" }),
      }),
    );
    const actions = data.appendAuditRow.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["payment.recorded", "job.status_changed"]);
  });

  it("closes a job out when the last of the balance is paid, and the receipt asks for a review", async () => {
    data.findRowByJobId.mockResolvedValue({ row: row({ status: "In Progress", deposit_paid_cents: "20000", balance_owed_cents: "10000" }) });
    data.listActivitiesForJob.mockResolvedValue([quoteSent, balanceLink]);

    const res = await recordManualPayment({ jobId: JOB, amountCents: 10000, method: "check", methodDetail: "1043", closeOut: true, actor: ACTOR });

    expect(res).toMatchObject({ ok: true, kind: "balance", balanceAfterCents: 0, statusAfter: "Complete", closedOut: true, linksClosed: 2, reviewRequested: true });
    const patch = data.updateRowByJobId.mock.calls[0][1];
    expect(patch).toMatchObject({ balance_owed_cents: "0", status: "Complete" });
    expect(patch.complete_date).toEqual(expect.any(String));
    expect(patch).not.toHaveProperty("deposit_paid_cents");
    expect(receipt.sendPaymentReceiptEmail).toHaveBeenCalledWith(expect.objectContaining({ methodLabel: "Check #1043", reviewAsk: true }));
    expect(data.updateRowByJobId).toHaveBeenCalledWith(JOB, { review_sent_at: expect.any(String), review_send_count: "1" });
    const actions = data.appendAuditRow.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["payment.recorded", "job.completed", "review.requested"]);
  });

  it("takes the balance left as given, and refuses a close-out with money still owed before writing anything", async () => {
    const custom = await recordManualPayment({ jobId: JOB, amountCents: 5000, method: "venmo", balanceAfterCents: 40000, actor: ACTOR });
    expect(custom).toMatchObject({ ok: true, balanceAfterCents: 40000 });

    vi.clearAllMocks();
    const refused = await recordManualPayment({ jobId: JOB, amountCents: 5000, method: "cash", closeOut: true, actor: ACTOR });
    expect(refused).toEqual({ ok: false, error: "Closing the job out needs nothing left owed; the balance would be $250.00." });
    expect(ledger.recordPayment).not.toHaveBeenCalled();
    expect(data.updateRowByJobId).not.toHaveBeenCalled();
  });

  it("validates the amount and an Other method's description", async () => {
    expect(await recordManualPayment({ jobId: JOB, amountCents: 0, method: "cash", actor: ACTOR })).toMatchObject({ ok: false });
    expect(await recordManualPayment({ jobId: JOB, amountCents: 100, method: "other", actor: ACTOR })).toMatchObject({ ok: false, error: expect.stringContaining("Cash App") });
    expect(await recordManualPayment({ jobId: JOB, amountCents: 100, method: "bitcoin" as never, actor: ACTOR })).toMatchObject({ ok: false });
    expect(ledger.recordPayment).not.toHaveBeenCalled();
  });

  it("keeps the payment when Stripe or the emails fail, and says what to do", async () => {
    links.deactivatePaymentLinks.mockRejectedValue(new Error("stripe down"));
    receipt.sendPaymentReceiptEmail.mockRejectedValue(new Error("gmail down"));
    office.sendPaymentNotice.mockRejectedValue(new Error("gmail down"));
    const res = await recordManualPayment({ jobId: JOB, amountCents: 30000, method: "zelle", actor: ACTOR });
    expect(res).toMatchObject({ ok: true, linksClosed: 0, receipt: "failed" });
    if (res.ok) expect(res.message).toContain("turn them off in Stripe");
    expect(data.updateRowByJobId).toHaveBeenCalled();
  });

  it("sends no receipt when asked not to, and never asks an unsubscribed customer for a review", async () => {
    data.findRowByJobId.mockResolvedValue({ row: row({ status: "Booked", deposit_paid_cents: "100", balance_owed_cents: "5000", opt_out: "true" }) });
    const skipped = await recordManualPayment({ jobId: JOB, amountCents: 5000, method: "cash", closeOut: true, emailCustomer: false, actor: ACTOR });
    expect(skipped).toMatchObject({ ok: true, receipt: "skipped", reviewRequested: false });
    expect(receipt.sendPaymentReceiptEmail).not.toHaveBeenCalled();

    const sent = await recordManualPayment({ jobId: JOB, amountCents: 5000, method: "cash", closeOut: true, actor: ACTOR });
    expect(sent).toMatchObject({ ok: true, receipt: "sent", reviewRequested: false });
    expect(receipt.sendPaymentReceiptEmail).toHaveBeenCalledWith(expect.objectContaining({ reviewAsk: false }));
  });
});
