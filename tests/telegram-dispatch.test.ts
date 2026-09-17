import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/telegram/dispatch.ts FYI fan-out. David keeps the one card with buttons;
// Mitch (owner) and operations (Mom) get informational copies. These tests
// pin: the recipient list is built from TELEGRAM_MITCH_CHAT_ID and
// TELEGRAM_OPS_CHAT_ID with blanks and duplicates dropped; each recipient gets
// a plain message (no reply_markup); one failed send never stops the others;
// and the callback data round trip David's buttons depend on is unchanged.

const client = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));
vi.mock("@/lib/telegram/client", () => client);
vi.mock("@/lib/security/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskPhone: (p: string | undefined) => (p ? "masked" : ""),
}));

import {
  buildCallbackData,
  getFyiChatIds,
  notifyFyiBooking,
  notifyFyiNewLead,
  parseCallbackData,
} from "@/lib/telegram/dispatch";
import type { ContactRow } from "@/lib/sheet/repo";

const row: ContactRow = {
  submitted_at: "2026-09-17T14:00:00.000Z",
  name: "Sarah Kim",
  phone: "+19195550142",
  email: "sarah@example.com",
  address: "412 Oak St, Garner, NC",
  service_type: "mounting",
  preferred_date: "",
  description: "Two TVs mounted",
  referral_source: "Neighbor",
  status: "New",
  job_id: "11111111-2222-4333-8444-555555555555",
  service_categories: "mounting",
};

beforeEach(() => {
  vi.clearAllMocks();
  client.sendMessage.mockResolvedValue({ message_id: 7 });
  delete process.env.TELEGRAM_MITCH_CHAT_ID;
  delete process.env.TELEGRAM_OPS_CHAT_ID;
});

afterEach(() => {
  delete process.env.TELEGRAM_MITCH_CHAT_ID;
  delete process.env.TELEGRAM_OPS_CHAT_ID;
});

describe("getFyiChatIds", () => {
  it("is Mitch alone when the ops id is unset", () => {
    process.env.TELEGRAM_MITCH_CHAT_ID = "111";
    expect(getFyiChatIds()).toEqual(["111"]);
  });

  it("is both when both are set, trimmed, in a stable order", () => {
    process.env.TELEGRAM_MITCH_CHAT_ID = " 111 ";
    process.env.TELEGRAM_OPS_CHAT_ID = "222";
    expect(getFyiChatIds()).toEqual(["111", "222"]);
  });

  it("drops blanks and duplicates", () => {
    process.env.TELEGRAM_MITCH_CHAT_ID = "111";
    process.env.TELEGRAM_OPS_CHAT_ID = "111";
    expect(getFyiChatIds()).toEqual(["111"]);
    process.env.TELEGRAM_MITCH_CHAT_ID = "";
    process.env.TELEGRAM_OPS_CHAT_ID = "  ";
    expect(getFyiChatIds()).toEqual([]);
  });
});

describe("notifyFyiNewLead", () => {
  it("sends one plain card per recipient", async () => {
    process.env.TELEGRAM_MITCH_CHAT_ID = "111";
    process.env.TELEGRAM_OPS_CHAT_ID = "222";

    const res = await notifyFyiNewLead(row);

    expect(res).toEqual({ ok: true, sent: 2, failed: 0 });
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
    expect(client.sendMessage.mock.calls[0][0]).toBe("111");
    expect(client.sendMessage.mock.calls[1][0]).toBe("222");
    for (const call of client.sendMessage.mock.calls) {
      expect(call[1]).toContain("New lead in");
      expect(call[1]).toContain("Sarah Kim");
      expect(call[2]).toBeUndefined(); // no keyboard on FYI copies
    }
  });

  it("keeps going when one recipient fails, and reports the counts", async () => {
    process.env.TELEGRAM_MITCH_CHAT_ID = "111";
    process.env.TELEGRAM_OPS_CHAT_ID = "222";
    client.sendMessage.mockRejectedValueOnce(new Error("chat not found")).mockResolvedValueOnce({ message_id: 9 });

    const res = await notifyFyiNewLead(row);

    expect(res).toEqual({ ok: true, sent: 1, failed: 1 });
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("reports send-failed when nobody could be reached", async () => {
    process.env.TELEGRAM_MITCH_CHAT_ID = "111";
    client.sendMessage.mockResolvedValue(null);

    const res = await notifyFyiNewLead(row);

    expect(res).toEqual({ ok: false, sent: 0, failed: 1, reason: "send-failed" });
  });

  it("skips cleanly with no recipients configured", async () => {
    const res = await notifyFyiNewLead(row);
    expect(res).toEqual({ ok: false, sent: 0, failed: 0, reason: "no-chat-id" });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses a row with no job id", async () => {
    process.env.TELEGRAM_MITCH_CHAT_ID = "111";
    const res = await notifyFyiNewLead({ ...row, job_id: "" });
    expect(res.reason).toBe("no-job-id");
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
});

describe("notifyFyiBooking", () => {
  it("sends the booking card to every recipient without buttons", async () => {
    process.env.TELEGRAM_MITCH_CHAT_ID = "111";
    process.env.TELEGRAM_OPS_CHAT_ID = "222";

    const res = await notifyFyiBooking(row, {
      startsAt: "2026-09-20T13:00:00.000Z",
      endsAt: "2026-09-20T15:00:00.000Z",
    });

    expect(res).toEqual({ ok: true, sent: 2, failed: 0 });
    expect(client.sendMessage).toHaveBeenCalledTimes(2);
    expect(client.sendMessage.mock.calls[0][1]).toContain("New booking");
    expect(client.sendMessage.mock.calls[0][2]).toBeUndefined();
  });
});

describe("callback data", () => {
  it("round trips the action and job id David's buttons carry", () => {
    const data = buildCallbackData("a", row.job_id as string);
    expect(data.length).toBeLessThanOrEqual(64);
    expect(parseCallbackData(data)).toEqual({ action: "a", jobId: row.job_id });
    expect(parseCallbackData("x:nope")).toBeNull();
  });
});
