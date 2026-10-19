import { beforeEach, describe, expect, it, vi } from "vitest";

// Asking for a Google review by hand (lib/crm/review.ts): same email as the
// daily review cron, stamped and counted so the cron won't ask again, never to
// a customer who unsubscribed.

const data = vi.hoisted(() => ({ appendAuditRow: vi.fn(), findRowByJobId: vi.fn(), updateRowByJobId: vi.fn() }));
const mail = vi.hoisted(() => ({ sendReviewRequestEmail: vi.fn() }));
vi.mock("@/lib/data", () => data);
vi.mock("@/lib/email/review-request", () => mail);
vi.mock("@/lib/security/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { requestReview } from "@/lib/crm/review";

const ACTOR = "claude:mom";
const base = { email: "jane@example.com", name: "Jane Doe", address: "12 Oak St, Garner, NC 27529", service_type: "TV mounting", service_categories: "", opt_out: "", review_send_count: "1" };

beforeEach(() => {
  vi.clearAllMocks();
  data.findRowByJobId.mockResolvedValue({ row: base });
  mail.sendReviewRequestEmail.mockResolvedValue(undefined);
});

describe("requestReview", () => {
  it("sends the review email, then stamps and counts it", async () => {
    const res = await requestReview({ jobId: "j1", actor: ACTOR });
    expect(mail.sendReviewRequestEmail).toHaveBeenCalledWith({
      toEmail: "jane@example.com",
      toName: "Jane Doe",
      customerCity: "Garner",
    });
    expect(data.updateRowByJobId).toHaveBeenCalledWith("j1", { review_sent_at: expect.any(String), review_send_count: "2" });
    expect(data.appendAuditRow).toHaveBeenCalledWith(expect.objectContaining({ action: "review.requested", actor: ACTOR, notes: "Review request #2." }));
    expect(res).toMatchObject({ ok: true, sendCount: 2 });
  });

  it("refuses an unsubscribed customer or one with no email, sending nothing", async () => {
    data.findRowByJobId.mockResolvedValue({ row: { ...base, opt_out: "TRUE" } });
    expect(await requestReview({ jobId: "j1", actor: ACTOR })).toMatchObject({ ok: false, error: expect.stringContaining("unsubscribed") });
    data.findRowByJobId.mockResolvedValue({ row: { ...base, email: "" } });
    expect(await requestReview({ jobId: "j1", actor: ACTOR })).toMatchObject({ ok: false });
    expect(mail.sendReviewRequestEmail).not.toHaveBeenCalled();
  });
});
