import { describe, expect, it } from "vitest";
import { isDepositPayment, paymentMethodLabel, suggestBalanceAfter } from "@/lib/payment-methods";

describe("payment methods", () => {
  it("labels a payment the way the receipt and timeline say it", () => {
    expect(paymentMethodLabel("cash")).toBe("Cash");
    expect(paymentMethodLabel("check", "1043")).toBe("Check #1043");
    expect(paymentMethodLabel("check", "money order")).toBe("Check (money order)");
    expect(paymentMethodLabel("other", "Cash App")).toBe("Other (Cash App)");
  });

  it("treats the first payment on an unbooked job as the deposit", () => {
    expect(isDepositPayment({ status: "Quoted", depositPaidCents: 0 })).toBe(true);
    expect(isDepositPayment({ status: "New", depositPaidCents: 0 })).toBe(true);
    expect(isDepositPayment({ status: "Booked", depositPaidCents: 0 })).toBe(false);
    expect(isDepositPayment({ status: "Quoted", depositPaidCents: 5000 })).toBe(false);
  });

  it("suggests the balance left from the quote for a deposit, else from what is owed, never below zero", () => {
    const quoted = { status: "Quoted", depositPaidCents: 0, balanceOwedCents: 10000, lastQuoteTotalCents: 30000 };
    expect(suggestBalanceAfter({ ...quoted, amountCents: 20000 })).toBe(10000);
    expect(suggestBalanceAfter({ ...quoted, amountCents: 30000 })).toBe(0);
    expect(suggestBalanceAfter({ ...quoted, lastQuoteTotalCents: null, amountCents: 5000 })).toBe(5000);
    const booked = { status: "Booked", depositPaidCents: 20000, balanceOwedCents: 10000, lastQuoteTotalCents: 30000 };
    expect(suggestBalanceAfter({ ...booked, amountCents: 4000 })).toBe(6000);
    expect(suggestBalanceAfter({ ...booked, amountCents: 99999 })).toBe(0);
  });
});
