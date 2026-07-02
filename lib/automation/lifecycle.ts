import type { JobRow } from "@/lib/data";
import { ACTIONS } from "@/lib/data/activity-actions";
import { easternIsoDate } from "@/lib/scheduling/time";

// Pure candidate-selection logic for the daily lifecycle cron
// (app/api/cron/lifecycle/route.ts). Everything here is deliberately
// side-effect-free and clock-injected so the picking rules are unit-testable;
// the route owns all I/O (data reads, email sends, audit writes).
//
// Dedupe strategy per check (Hobby cron = one run per day):
//  - Appointment reminders: the "tomorrow in ET" bucket matches each
//    appointment on exactly one run day — no stored state needed.
//  - Quote nudges: the [24h, 48h) window before expiry is exactly one daily
//    run wide, AND the route writes a `quote.nudge_sent` audit activity that
//    `alreadyNudged` checks — belt and braces against cron-time drift.
//  - Digest / reconciliation: report-only, safe to repeat.

const HOUR_MS = 60 * 60 * 1000;

function timeOf(iso: string | undefined | null): number {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
}

export function isOptedOut(row: JobRow): boolean {
  return (row.opt_out || "").trim().toLowerCase() === "true";
}

// --- Appointment reminders ---------------------------------------------------

// True when the appointment starts on TOMORROW's Eastern calendar day relative
// to `now`. Run daily at ~9 AM ET, this gives customers 15–39h notice.
export function isReminderDay(startsAtIso: string, now: Date): boolean {
  const starts = timeOf(startsAtIso);
  if (!Number.isFinite(starts)) return false;
  const tomorrow = new Date(now.getTime() + 24 * HOUR_MS);
  return easternIsoDate(new Date(starts)) === easternIsoDate(tomorrow);
}

// --- Quote nudges -------------------------------------------------------------

export interface QuoteMeta {
  sentAt: string;
  // What the quote email told the customer (stamped into the quote.sent
  // activity payload). Empty for quotes sent before the payload carried it.
  expiresAt: string;
  paymentLinkUrl: string;
  depositCents: number | null;
  balanceCents: number | null;
}

interface ActivityLike {
  action: string;
  at: string;
  data: unknown;
}

// listActivitiesForJob returns newest-first, so the first quote.sent is the
// latest (re-)quote — the one whose link the customer holds.
export function extractQuoteMeta(activities: ActivityLike[]): QuoteMeta | null {
  const activity = activities.find((a) => a.action === ACTIONS.QUOTE_SENT);
  if (!activity) return null;
  const data = activity.data as { after?: Record<string, unknown> } | null;
  const after = data?.after ?? {};
  return {
    sentAt: activity.at,
    expiresAt: typeof after.expiresAt === "string" ? after.expiresAt : "",
    paymentLinkUrl:
      typeof after.paymentLinkUrl === "string" ? after.paymentLinkUrl : "",
    depositCents:
      typeof after.depositCents === "number" ? after.depositCents : null,
    balanceCents:
      typeof after.balanceCents === "number" ? after.balanceCents : null,
  };
}

export function alreadyNudged(activities: { action: string }[]): boolean {
  return activities.some((a) => a.action === ACTIONS.QUOTE_NUDGE_SENT);
}

export function quoteExpiryMs(meta: QuoteMeta): number {
  const stamped = timeOf(meta.expiresAt);
  if (Number.isFinite(stamped)) return stamped;
  // Legacy quotes (no stamped expiry): the quote email always said 7 days.
  const sent = timeOf(meta.sentAt);
  return Number.isFinite(sent) ? sent + 7 * 24 * HOUR_MS : Number.NaN;
}

// Nudge exactly once: when expiry is 24–48h out (window width = run cadence).
export function isInNudgeWindow(meta: QuoteMeta, now: Date): boolean {
  const expiry = quoteExpiryMs(meta);
  if (!Number.isFinite(expiry)) return false;
  const remaining = expiry - now.getTime();
  return remaining >= 24 * HOUR_MS && remaining < 48 * HOUR_MS;
}

// --- Owner digest -------------------------------------------------------------

export interface DigestQuoteItem {
  row: JobRow;
  sentAt: string;
  expiresAt: string;
}

export interface DigestSections {
  // status New, no first touch recorded, older than 48h
  staleLeads: JobRow[];
  // status Quoted, quote sent more than 3 days ago
  unpaidQuotes: DigestQuoteItem[];
  // status Quoted, link expiry less than 48h away (including already past)
  expiringQuotes: DigestQuoteItem[];
  paymentFailed: JobRow[];
}

export function buildDigestSections(
  rows: JobRow[],
  quoteMetaByJobId: Map<string, QuoteMeta>,
  now: Date,
): DigestSections {
  const staleLeads = rows.filter((r) => {
    if ((r.status || "").trim() !== "New") return false;
    if ((r.first_touch_sent_at || "").trim()) return false;
    const age = now.getTime() - timeOf(r.submitted_at);
    return Number.isFinite(age) && age > 48 * HOUR_MS;
  });

  const quoted = rows.filter((r) => (r.status || "").trim() === "Quoted");
  const unpaidQuotes: DigestQuoteItem[] = [];
  const expiringQuotes: DigestQuoteItem[] = [];
  for (const row of quoted) {
    const meta = quoteMetaByJobId.get(row.job_id || "");
    if (!meta) continue;
    const expiry = quoteExpiryMs(meta);
    const item: DigestQuoteItem = {
      row,
      sentAt: meta.sentAt,
      expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : "",
    };
    const sentAge = now.getTime() - timeOf(meta.sentAt);
    if (Number.isFinite(sentAge) && sentAge > 3 * 24 * HOUR_MS) {
      unpaidQuotes.push(item);
    }
    if (Number.isFinite(expiry) && expiry - now.getTime() < 48 * HOUR_MS) {
      expiringQuotes.push(item);
    }
  }

  const paymentFailed = rows.filter(
    (r) => (r.status || "").trim() === "Payment Failed",
  );

  return { staleLeads, unpaidQuotes, expiringQuotes, paymentFailed };
}

export function digestIsEmpty(sections: DigestSections): boolean {
  return (
    sections.staleLeads.length === 0 &&
    sections.unpaidQuotes.length === 0 &&
    sections.expiringQuotes.length === 0 &&
    sections.paymentFailed.length === 0
  );
}

// --- Stripe reconciliation backstop -------------------------------------------

// A minimal, provider-agnostic shape the route maps Stripe events into, so
// the drift rules stay unit-testable without Stripe fixtures.
export interface MoneyEvent {
  type: "checkout.session.completed" | "charge.refunded";
  jobId: string | null;
  // Only meaningful for charge.refunded: charge.refunded === true.
  fullyRefunded?: boolean;
}

export interface DriftFinding {
  jobId: string;
  kind: "deposit-not-booked" | "refund-not-flipped";
  detail: string;
}

// Statuses a job may legitimately hold BEFORE any deposit money landed. A
// checkout.session.completed for a job still in one of these means the
// webhook's status flip was lost — the exact failure the backstop exists for.
// 'Cancelled' stays in this set ON PURPOSE: a deposit landing on a cancelled
// job (customer paid a stale link) is money the owner must refund — exactly
// the kind of thing the digest should surface, not suppress.
const PRE_DEPOSIT_STATUSES = new Set([
  "",
  "New",
  "Quoted",
  "Pending Follow-Up",
  "Cancelled",
]);

export function findDrift(
  events: MoneyEvent[],
  statusByJobId: Map<string, string>,
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (!event.jobId) continue;
    const status = (statusByJobId.get(event.jobId) || "").trim();
    if (event.type === "checkout.session.completed") {
      const key = `deposit:${event.jobId}`;
      if (PRE_DEPOSIT_STATUSES.has(status) && !seen.has(key)) {
        seen.add(key);
        findings.push({
          jobId: event.jobId,
          kind: "deposit-not-booked",
          detail: `Stripe says the deposit was paid, but the job status is "${status || "unknown"}".`,
        });
      }
    } else if (event.type === "charge.refunded" && event.fullyRefunded) {
      const key = `refund:${event.jobId}`;
      if (
        status !== "Refunded" &&
        status !== "Partial Refund" &&
        !seen.has(key)
      ) {
        seen.add(key);
        findings.push({
          jobId: event.jobId,
          kind: "refund-not-flipped",
          detail: `Stripe says a charge was fully refunded, but the job status is "${status || "unknown"}".`,
        });
      }
    }
  }
  return findings;
}
