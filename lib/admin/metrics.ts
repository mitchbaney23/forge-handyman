import type { JobRow } from "@/lib/data";
import { easternIsoDate } from "@/lib/scheduling/time";

// Pure business-metrics math for the /admin "How's business" strip. All
// clock-injected and side-effect-free; the page owns the data loading
// (payments query + quote.sent activity lookup are postgres-only).

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PaymentLite {
  purpose: string;
  status: string;
  amountCents: number | null;
  createdAt: string;
}

// The payment purposes that are money IN from a customer: the quote deposit,
// the saved-card balance charge at Mark Complete, a balance paid through an
// emailed balance link, and a payment taken outside Stripe (cash, check,
// Venmo, Zelle) recorded by hand. Refund rows are money back out.
export const MONEY_IN_PURPOSES = new Set(["deposit", "balance-charge", "balance-link", "manual"]);

// Revenue collected this Eastern-calendar month: deposits + balance payments
// minus refunds. Refund rows hold the CUMULATIVE refunded amount per charge
// (see lib/data/pg/payments.ts recordRefund), so summing them is correct.
// Deliberately CASH-BASIS: a refund issued this month reduces this month's
// number even when the deposit landed last month — the metric answers "how
// much cash did this month net", not accrual revenue per job.
export function revenueThisMonthCents(
  payments: PaymentLite[],
  now: Date,
): number {
  const monthKey = easternIsoDate(now).slice(0, 7);
  let total = 0;
  for (const p of payments) {
    if (p.status !== "succeeded" || p.amountCents === null) continue;
    const created = new Date(p.createdAt);
    if (!Number.isFinite(created.getTime())) continue;
    if (!easternIsoDate(created).startsWith(monthKey)) continue;
    if (MONEY_IN_PURPOSES.has(p.purpose)) {
      total += p.amountCents;
    } else if (p.purpose === "refund") {
      total -= p.amountCents;
    }
  }
  return total;
}

// What each job has netted from its customer, all time: succeeded money-in
// payments minus refunds (refund rows hold the cumulative refunded amount per
// charge, so summing them is correct). recordPayment is best-effort, so a job
// whose deposit landed (deposit_paid_cents) but has no deposit row in the
// ledger (a Stripe "deposit", or a "manual" payment recorded as the deposit)
// adds that deposit rather than losing it. Jobs that net zero are left out.
export interface SpendPayment {
  jobId: string;
  purpose: string;
  status: string;
  amountCents: number | null;
  // A manual payment's data.kind: "deposit" or "balance".
  kind?: string;
}

export interface SpendJob {
  jobId: string;
  depositPaidCents: number;
}

export function spentCentsByJob(
  payments: SpendPayment[],
  jobs: SpendJob[],
): Map<string, number> {
  const net = new Map<string, number>();
  const hasDepositRow = new Set<string>();
  for (const p of payments) {
    if (!p.jobId || p.status !== "succeeded" || p.amountCents === null) continue;
    if (MONEY_IN_PURPOSES.has(p.purpose)) {
      net.set(p.jobId, (net.get(p.jobId) ?? 0) + p.amountCents);
      if (p.purpose === "deposit" || (p.purpose === "manual" && p.kind === "deposit")) {
        hasDepositRow.add(p.jobId);
      }
    } else if (p.purpose === "refund") {
      net.set(p.jobId, (net.get(p.jobId) ?? 0) - p.amountCents);
    }
  }
  for (const j of jobs) {
    if (!j.jobId || hasDepositRow.has(j.jobId) || j.depositPaidCents <= 0) continue;
    net.set(j.jobId, (net.get(j.jobId) ?? 0) + j.depositPaidCents);
  }
  for (const [jobId, cents] of net) if (cents === 0) net.delete(jobId);
  return net;
}

// A job counts as "paid" once deposit money landed (status flip or recorded
// deposit) — the same post-deposit notion the reconciliation backstop uses.
const POST_DEPOSIT_STATUSES = new Set([
  "Booked",
  "In Progress",
  "Complete",
  "Refunded",
  "Partial Refund",
  "Payment Failed",
]);

export interface QuoteConversion {
  quoted: number;
  paid: number;
}

// Of the jobs that got a quote (quote.sent activity) in the window, how many
// went on to pay a deposit?
export function quoteConversion(
  quotedJobIds: string[],
  rows: JobRow[],
): QuoteConversion {
  const byJobId = new Map<string, JobRow>();
  for (const row of rows) {
    if (row.job_id) byJobId.set(row.job_id, row);
  }
  const distinct = [...new Set(quotedJobIds)];
  let paid = 0;
  for (const jobId of distinct) {
    const row = byJobId.get(jobId);
    if (!row) continue;
    const depositCents = Number(row.deposit_paid_cents || "0");
    if (depositCents > 0 || POST_DEPOSIT_STATUSES.has((row.status || "").trim())) {
      paid += 1;
    }
  }
  return { quoted: distinct.length, paid };
}

// Median submitted -> completed cycle over jobs completed in the last 90 days.
// null when there's nothing to measure yet.
export function medianCycleDays(rows: JobRow[], now: Date): number | null {
  const cutoff = now.getTime() - 90 * DAY_MS;
  const cycles: number[] = [];
  for (const row of rows) {
    const completed = new Date(row.complete_date || "").getTime();
    const submitted = new Date(row.submitted_at || "").getTime();
    if (!Number.isFinite(completed) || !Number.isFinite(submitted)) continue;
    if (completed < cutoff || completed < submitted) continue;
    cycles.push((completed - submitted) / DAY_MS);
  }
  if (cycles.length === 0) return null;
  cycles.sort((a, b) => a - b);
  const mid = Math.floor(cycles.length / 2);
  const median =
    cycles.length % 2 === 1 ? cycles[mid] : (cycles[mid - 1] + cycles[mid]) / 2;
  return Math.round(median * 10) / 10;
}

export interface LeadSource {
  source: string;
  count: number;
}

// Where the last 30 days of leads came from, busiest first.
export function topLeadSources(
  rows: JobRow[],
  now: Date,
  limit = 3,
): LeadSource[] {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const counts = new Map<string, number>();
  for (const row of rows) {
    const submitted = new Date(row.submitted_at || "").getTime();
    if (!Number.isFinite(submitted) || submitted < cutoff) continue;
    const source =
      (row.referral_source || "").trim() ||
      (row.utm_source || "").trim() ||
      "Unknown";
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
    .slice(0, limit);
}
