import { describe, expect, it } from "vitest";
import {
  medianCycleDays,
  quoteConversion,
  revenueThisMonthCents,
  topLeadSources,
  type PaymentLite,
} from "@/lib/admin/metrics";
import type { JobRow } from "@/lib/data";

// Admin "How's business" math (lib/admin/metrics.ts) — pure, clock-injected.

const DAY = 24 * 60 * 60 * 1000;
// Mid-month reference: July 15, 2026, noon ET (16:00Z, EDT).
const NOW = new Date("2026-07-15T16:00:00.000Z");

function job(overrides: Partial<JobRow>): JobRow {
  return {
    submitted_at: "2026-07-01T12:00:00.000Z",
    status: "New",
    job_id: "11111111-2222-4333-8444-555555555555",
    ...overrides,
  } as JobRow;
}

function payment(overrides: Partial<PaymentLite>): PaymentLite {
  return {
    purpose: "deposit",
    status: "succeeded",
    amountCents: 10000,
    createdAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

describe("revenueThisMonthCents", () => {
  it("sums deposits + balances, subtracts refunds, within the ET month", () => {
    const payments = [
      payment({ amountCents: 10000 }),
      payment({ purpose: "balance-charge", amountCents: 25000 }),
      payment({ purpose: "refund", amountCents: 5000 }),
      payment({ createdAt: "2026-06-28T12:00:00.000Z", amountCents: 99999 }), // last month
      payment({ status: "failed", amountCents: 7777 }), // not collected
      payment({ purpose: "balance-charge", amountCents: null }), // no amount
    ];
    expect(revenueThisMonthCents(payments, NOW)).toBe(30000);
  });

  it("buckets by EASTERN month: a July-1st-ET payment stored late June 30 UTC... counts", () => {
    // 2026-07-01T02:00:00Z = June 30, 10 PM ET => NOT this ET month.
    // 2026-07-01T05:00:00Z = July 1, 1 AM ET  => IS this ET month.
    expect(
      revenueThisMonthCents([payment({ createdAt: "2026-07-01T02:00:00.000Z" })], NOW),
    ).toBe(0);
    expect(
      revenueThisMonthCents([payment({ createdAt: "2026-07-01T05:00:00.000Z" })], NOW),
    ).toBe(10000);
  });
});

describe("quoteConversion", () => {
  it("counts distinct quoted jobs and how many reached a post-deposit state", () => {
    const paidByStatus = job({ job_id: "a1", status: "Booked" });
    const paidByDeposit = job({ job_id: "a2", status: "Quoted", deposit_paid_cents: "5000" });
    const unpaid = job({ job_id: "a3", status: "Quoted" });
    const { quoted, paid } = quoteConversion(
      ["a1", "a2", "a3", "a1", "missing-job"],
      [paidByStatus, paidByDeposit, unpaid],
    );
    expect(quoted).toBe(4); // a1 deduped; missing-job still counts as quoted
    expect(paid).toBe(2);
  });

  it("returns zeros with no quotes", () => {
    expect(quoteConversion([], [])).toEqual({ quoted: 0, paid: 0 });
  });
});

describe("medianCycleDays", () => {
  it("takes the median of completes in the last 90 days", () => {
    const complete = (submittedDaysAgo: number, completedDaysAgo: number, id: string) =>
      job({
        job_id: id,
        status: "Complete",
        submitted_at: new Date(NOW.getTime() - submittedDaysAgo * DAY).toISOString(),
        complete_date: new Date(NOW.getTime() - completedDaysAgo * DAY).toISOString(),
      });
    const rows = [
      complete(10, 8, "c1"), // 2-day cycle
      complete(20, 14, "c2"), // 6-day cycle
      complete(30, 20, "c3"), // 10-day cycle
      complete(200, 150, "old"), // outside 90d window
      job({ status: "New" }), // never completed
    ];
    expect(medianCycleDays(rows, NOW)).toBe(6);
  });

  it("returns null with nothing completed recently", () => {
    expect(medianCycleDays([job({})], NOW)).toBeNull();
  });
});

describe("topLeadSources", () => {
  it("groups the last 30 days by referral source with utm fallback, busiest first", () => {
    const recent = (source: Partial<JobRow>, id: string) =>
      job({
        job_id: id,
        submitted_at: new Date(NOW.getTime() - 5 * DAY).toISOString(),
        ...source,
      });
    const rows = [
      recent({ referral_source: "Google" }, "s1"),
      recent({ referral_source: "Google" }, "s2"),
      recent({ referral_source: "", utm_source: "nextdoor" }, "s3"),
      recent({ referral_source: "" }, "s4"), // Unknown
      job({ referral_source: "Google", submitted_at: new Date(NOW.getTime() - 45 * DAY).toISOString() }), // too old
    ];
    expect(topLeadSources(rows, NOW)).toEqual([
      { source: "Google", count: 2 },
      // count ties break alphabetically (locale order: n < U)
      { source: "nextdoor", count: 1 },
      { source: "Unknown", count: 1 },
    ]);
  });
});
