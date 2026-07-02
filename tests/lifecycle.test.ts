import { describe, expect, it } from "vitest";
import {
  alreadyNudged,
  buildDigestSections,
  digestIsEmpty,
  extractQuoteMeta,
  findDrift,
  isInNudgeWindow,
  isReminderDay,
  quoteExpiryMs,
  type MoneyEvent,
  type QuoteMeta,
} from "@/lib/automation/lifecycle";
import type { JobRow } from "@/lib/data";

// Lifecycle-cron candidate selection (lib/automation/lifecycle.ts). The
// contracts that keep the daily cron exactly-once without stored state:
//  - reminders fire only for appointments on TOMORROW's Eastern calendar day;
//  - quote nudges fire only in the [24h, 48h) window before the promised
//    expiry (window width = daily cadence), with the quote.nudge_sent
//    activity as the durable second guard;
//  - drift findings compare Stripe money events against job status,
//    deduped per (kind, job).

const HOUR = 60 * 60 * 1000;

// A fixed reference instant: 9:00 AM ET on a summer Wednesday (EDT = UTC-4).
const NOW = new Date("2026-07-08T13:00:00.000Z");

function job(overrides: Partial<JobRow>): JobRow {
  return {
    submitted_at: "2026-07-01T12:00:00.000Z",
    name: "Jane",
    email: "jane@example.com",
    status: "New",
    job_id: "11111111-2222-4333-8444-555555555555",
    ...overrides,
  } as JobRow;
}

describe("isReminderDay", () => {
  it("matches an appointment on tomorrow's ET calendar day", () => {
    // 2026-07-09 09:00 ET = 13:00Z — tomorrow relative to NOW.
    expect(isReminderDay("2026-07-09T13:00:00.000Z", NOW)).toBe(true);
  });

  it("rejects today and the day after tomorrow", () => {
    expect(isReminderDay("2026-07-08T18:00:00.000Z", NOW)).toBe(false);
    expect(isReminderDay("2026-07-10T13:00:00.000Z", NOW)).toBe(false);
  });

  it("buckets by EASTERN day, not UTC day", () => {
    // 2026-07-10T01:00Z is still July 9 in ET (9 PM EDT) => tomorrow => match.
    expect(isReminderDay("2026-07-10T01:00:00.000Z", NOW)).toBe(true);
  });

  it("rejects garbage timestamps", () => {
    expect(isReminderDay("", NOW)).toBe(false);
    expect(isReminderDay("not-a-date", NOW)).toBe(false);
  });
});

describe("extractQuoteMeta / alreadyNudged", () => {
  const activities = [
    { action: "note.added", at: "2026-07-07T00:00:00.000Z", data: null },
    {
      action: "quote.sent",
      at: "2026-07-06T00:00:00.000Z",
      // Faithful to the full shape sendQuote's appendAuditRow writes —
      // extra fields must be ignored, not tripped over.
      data: {
        after: {
          paymentLinkId: "plink_123",
          paymentLinkUrl: "https://buy.stripe.com/abc",
          expiresAt: "2026-07-13T00:00:00.000Z",
          depositCents: 5000,
          balanceCents: 20000,
          tier: "medium",
          customerEmail: "j***@example.com",
        },
      },
    },
    // An older re-quoted entry that must NOT win (list is newest-first).
    {
      action: "quote.sent",
      at: "2026-07-01T00:00:00.000Z",
      data: { after: { paymentLinkUrl: "https://buy.stripe.com/old" } },
    },
  ];

  it("takes the NEWEST quote.sent and reads the stamped payload", () => {
    const meta = extractQuoteMeta(activities);
    expect(meta).toEqual({
      sentAt: "2026-07-06T00:00:00.000Z",
      expiresAt: "2026-07-13T00:00:00.000Z",
      paymentLinkUrl: "https://buy.stripe.com/abc",
      depositCents: 5000,
      balanceCents: 20000,
    });
  });

  it("returns null with no quote.sent activity", () => {
    expect(extractQuoteMeta([{ action: "note.added", at: "", data: null }])).toBeNull();
  });

  it("tolerates legacy payloads without the stamped fields", () => {
    const meta = extractQuoteMeta([
      { action: "quote.sent", at: "2026-07-06T00:00:00.000Z", data: { after: {} } },
    ]);
    expect(meta).toMatchObject({ expiresAt: "", paymentLinkUrl: "", depositCents: null });
  });

  it("alreadyNudged sees the durable guard activity", () => {
    expect(alreadyNudged([{ action: "quote.nudge_sent" }])).toBe(true);
    expect(alreadyNudged([{ action: "quote.sent" }])).toBe(false);
  });
});

describe("quoteExpiryMs / isInNudgeWindow", () => {
  function meta(overrides: Partial<QuoteMeta>): QuoteMeta {
    return {
      sentAt: "2026-07-06T00:00:00.000Z",
      expiresAt: "",
      paymentLinkUrl: "",
      depositCents: null,
      balanceCents: null,
      ...overrides,
    };
  }

  it("prefers the stamped expiry; falls back to sentAt + 7 days for legacy quotes", () => {
    expect(quoteExpiryMs(meta({ expiresAt: "2026-07-10T00:00:00.000Z" }))).toBe(
      new Date("2026-07-10T00:00:00.000Z").getTime(),
    );
    expect(quoteExpiryMs(meta({}))).toBe(
      new Date("2026-07-06T00:00:00.000Z").getTime() + 7 * 24 * HOUR,
    );
  });

  it("fires only inside [24h, 48h) before expiry — exactly one daily run", () => {
    const at = (hoursFromNow: number) =>
      meta({ expiresAt: new Date(NOW.getTime() + hoursFromNow * HOUR).toISOString() });
    expect(isInNudgeWindow(at(47), NOW)).toBe(true);
    expect(isInNudgeWindow(at(24), NOW)).toBe(true);
    expect(isInNudgeWindow(at(48), NOW)).toBe(false); // tomorrow's run catches it
    expect(isInNudgeWindow(at(23), NOW)).toBe(false); // yesterday's run caught it
    expect(isInNudgeWindow(at(-2), NOW)).toBe(false); // already expired
  });

  it("never fires on unparseable dates", () => {
    expect(isInNudgeWindow(meta({ sentAt: "garbage" }), NOW)).toBe(false);
  });
});

describe("buildDigestSections", () => {
  it("classifies stale leads, unpaid + expiring quotes, and payment failures", () => {
    const quotedOld = job({ job_id: "22222222-2222-4333-8444-555555555555", status: "Quoted" });
    const rows: JobRow[] = [
      job({ submitted_at: new Date(NOW.getTime() - 60 * HOUR).toISOString() }), // stale lead
      job({ submitted_at: new Date(NOW.getTime() - 10 * HOUR).toISOString() }), // fresh lead
      job({ status: "New", first_touch_sent_at: "2026-07-01T00:00:00.000Z", submitted_at: "2026-06-01T00:00:00.000Z" }), // touched
      quotedOld,
      job({ status: "Payment Failed", job_id: "33333333-2222-4333-8444-555555555555" }),
    ];
    const metaMap = new Map([
      [
        quotedOld.job_id!,
        {
          sentAt: new Date(NOW.getTime() - 4 * 24 * HOUR).toISOString(), // 4 days ago
          expiresAt: new Date(NOW.getTime() + 30 * HOUR).toISOString(), // expiring soon
          paymentLinkUrl: "",
          depositCents: null,
          balanceCents: null,
        },
      ],
    ]);

    const sections = buildDigestSections(rows, metaMap, NOW);
    expect(sections.staleLeads).toHaveLength(1);
    expect(sections.unpaidQuotes).toHaveLength(1);
    expect(sections.expiringQuotes).toHaveLength(1);
    expect(sections.paymentFailed).toHaveLength(1);
    expect(digestIsEmpty(sections)).toBe(false);
  });

  it("is empty when nothing needs a push", () => {
    const sections = buildDigestSections(
      [job({ submitted_at: NOW.toISOString() })],
      new Map(),
      NOW,
    );
    expect(digestIsEmpty(sections)).toBe(true);
  });
});

describe("findDrift", () => {
  const statusBy = new Map([
    ["job-booked", "Booked"],
    ["job-still-quoted", "Quoted"],
    ["job-refunded", "Refunded"],
    ["job-complete", "Complete"],
  ]);

  it("flags a paid deposit whose job never left a pre-deposit status", () => {
    const events: MoneyEvent[] = [
      { type: "checkout.session.completed", jobId: "job-booked" },
      { type: "checkout.session.completed", jobId: "job-still-quoted" },
    ];
    const findings = findDrift(events, statusBy);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ jobId: "job-still-quoted", kind: "deposit-not-booked" });
  });

  it("flags a full refund whose job status never flipped", () => {
    const events: MoneyEvent[] = [
      { type: "charge.refunded", jobId: "job-refunded", fullyRefunded: true },
      { type: "charge.refunded", jobId: "job-complete", fullyRefunded: true },
      { type: "charge.refunded", jobId: "job-complete", fullyRefunded: false }, // partial: ignored
    ];
    const findings = findDrift(events, statusBy);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ jobId: "job-complete", kind: "refund-not-flipped" });
  });

  it("dedupes repeated events per (kind, job) and skips null jobIds", () => {
    const events: MoneyEvent[] = [
      { type: "checkout.session.completed", jobId: "job-still-quoted" },
      { type: "checkout.session.completed", jobId: "job-still-quoted" },
      { type: "checkout.session.completed", jobId: null },
    ];
    expect(findDrift(events, statusBy)).toHaveLength(1);
  });
});
