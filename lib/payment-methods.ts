// Payments taken outside Stripe (cash, check, Venmo, Zelle, anything else)
// and recorded by hand on the job page or by Claude. Pure and client-safe: the
// Record a payment form suggests the balance with the same function the
// server core (lib/crm/payments.ts) uses.

export const PAYMENT_METHODS = ["cash", "check", "venmo", "zelle", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  check: "Check",
  venmo: "Venmo",
  zelle: "Zelle",
  other: "Other",
};

export const METHOD_DETAIL_MAX = 60;
export const PAYMENT_NOTE_MAX = 500;

// "Cash", "Check #1043", "Other (Cash App)".
export function paymentMethodLabel(method: PaymentMethod, detail?: string): string {
  const d = (detail ?? "").trim();
  if (method === "check" && d) return `Check ${/^\d+$/.test(d) ? `#${d}` : `(${d})`}`;
  if (d) return `${PAYMENT_METHOD_LABEL[method]} (${d})`;
  return PAYMENT_METHOD_LABEL[method];
}

// Statuses before any deposit: a payment recorded here is the deposit, and
// the job moves to Booked (mirrors the lifecycle cron's PRE_DEPOSIT_STATUSES).
export const PRE_DEPOSIT_STATUSES = new Set(["", "New", "Quoted", "Pending Follow-Up", "Cancelled"]);

export function isDepositPayment(job: { status: string; depositPaidCents: number }): boolean {
  return PRE_DEPOSIT_STATUSES.has(job.status.trim()) && job.depositPaidCents <= 0;
}

// What the balance owed should be after this payment, as a starting point the
// sender can change:
//   - the deposit on a quoted job: the quote's total (deposit + balance) minus
//     what was paid, so cash for the whole quote leaves nothing owed;
//   - any later payment: the balance owed now minus what was paid;
//   - never below zero.
export function suggestBalanceAfter(job: {
  status: string;
  depositPaidCents: number;
  balanceOwedCents: number;
  lastQuoteTotalCents: number | null;
  amountCents: number;
}): number {
  const owedBefore =
    isDepositPayment(job) && job.lastQuoteTotalCents != null
      ? job.lastQuoteTotalCents
      : job.balanceOwedCents;
  return Math.max(0, owedBefore - Math.max(0, job.amountCents));
}
