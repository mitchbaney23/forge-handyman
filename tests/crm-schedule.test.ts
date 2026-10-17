import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin/Claude scheduling core (lib/crm/schedule.ts) and the cancel path's
// calendar routing (lib/scheduling/cancel.ts). The data layer and Google are
// mocked; what is pinned:
//   - a past, too-short or overlapping window is refused before anything is
//     claimed or written,
//   - a booking claims the slot against the default technician, puts the event
//     on the OPERATIONS calendar, marks the appointment source 'admin', and
//     moves the job to Booked with both activities logged,
//   - a calendar failure releases the claimed slot and books nothing,
//   - cancelling an admin-sourced appointment deletes the event from the
//     operations calendar, a self-serve one from the technician's.

const data = vi.hoisted(() => ({
  appendAuditRow: vi.fn(),
  cancelAppointment: vi.fn(),
  claimSlot: vi.fn(),
  findRowByJobId: vi.fn(),
  getAppointmentById: vi.fn(),
  getAppointmentByJobId: vi.fn(),
  getDefaultTechnician: vi.fn(),
  getTechnicianById: vi.fn(),
  linkAppointment: vi.fn(),
  listAppointmentsInRange: vi.fn(),
  releaseSlot: vi.fn(),
  updateRowByJobId: vi.fn(),
}));
const google = vi.hoisted(() => ({ createBookingEvent: vi.fn(), deleteBookingEvent: vi.fn() }));

vi.mock("@/lib/data", () => data);
vi.mock("@/lib/google", () => google);
vi.mock("@/lib/telegram/dispatch", () => ({ notifyCancellation: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/security/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { checkScheduleWindow, scheduleJob } from "@/lib/crm/schedule";
import { performCancellation } from "@/lib/scheduling/cancel";

const ACTOR = "admin:owner@forge.test";
const NOW = new Date("2026-10-17T12:00:00.000Z");
const START = "2026-10-20T14:00:00.000Z"; // Tue Oct 20, 10:00 AM ET
const END = "2026-10-20T16:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OPERATIONS_CALENDAR_EMAIL;
  data.findRowByJobId.mockResolvedValue({
    row: { status: "New", name: "Jane", phone: "", email: "jane@example.com", address: "12 Oak St", service_type: "TV mounting", description: "", referral_source: "", submitted_at: "", preferred_date: "" },
  });
  data.getAppointmentByJobId.mockResolvedValue(null);
  data.getDefaultTechnician.mockResolvedValue({ id: "tech-1", calendarEmail: "david@forgehandyman.com" });
  data.listAppointmentsInRange.mockResolvedValue([]);
  data.claimSlot.mockResolvedValue({ id: "appt-1" });
  data.linkAppointment.mockResolvedValue(undefined);
  data.releaseSlot.mockResolvedValue(undefined);
  data.updateRowByJobId.mockResolvedValue({ updated: true });
  data.appendAuditRow.mockResolvedValue(undefined);
  google.createBookingEvent.mockResolvedValue("evt-1");
  google.deleteBookingEvent.mockResolvedValue(undefined);
});

describe("checkScheduleWindow", () => {
  it("refuses a time in the past, a too-short or too-long window, and garbage", async () => {
    expect((await checkScheduleWindow({ startsAt: "2026-10-16T14:00:00Z", endsAt: "2026-10-16T16:00:00Z", now: NOW })).ok).toBe(false);
    expect((await checkScheduleWindow({ startsAt: START, endsAt: "2026-10-20T14:15:00.000Z", now: NOW })).ok).toBe(false);
    expect((await checkScheduleWindow({ startsAt: START, endsAt: "2026-10-21T14:00:00.000Z", now: NOW })).ok).toBe(false);
    expect((await checkScheduleWindow({ startsAt: "nope", endsAt: END, now: NOW })).ok).toBe(false);
    expect(data.listAppointmentsInRange).not.toHaveBeenCalled();
  });

  it("refuses a window that overlaps a live booking, naming its time", async () => {
    data.listAppointmentsInRange.mockResolvedValue([
      { startsAt: "2026-10-20T15:00:00.000Z", endsAt: "2026-10-20T17:00:00.000Z" },
    ]);
    const res = await checkScheduleWindow({ startsAt: START, endsAt: END, now: NOW });
    expect(res).toEqual({
      ok: false,
      error: "That overlaps another booking: Tue, Oct 20, 11:00 AM–1:00 PM. Pick another time.",
    });
  });
});

describe("scheduleJob", () => {
  it("books the slot, puts it on the operations calendar, marks it admin, and moves the job to Booked", async () => {
    const res = await scheduleJob({ jobId: "job-1", startsAt: START, endsAt: END, actor: ACTOR, now: NOW });

    expect(res).toMatchObject({ ok: true, appointmentId: "appt-1", calendar: "operations@forgehandyman.com" });
    expect(data.claimSlot).toHaveBeenCalledWith({ jobId: "job-1", technicianId: "tech-1", startsAt: START, endsAt: END });
    expect(google.createBookingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "operations@forgehandyman.com", startsAt: START, endsAt: END }),
    );
    expect(data.linkAppointment).toHaveBeenCalledWith("appt-1", { googleEventId: "evt-1", source: "admin" });
    expect(data.updateRowByJobId).toHaveBeenCalledWith("job-1", { status: "Booked", preferred_date: "2026-10-20" });
    const actions = data.appendAuditRow.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual(["appointment.scheduled", "job.status_changed"]);
  });

  it("uses OPERATIONS_CALENDAR_EMAIL when set", async () => {
    process.env.OPERATIONS_CALENDAR_EMAIL = "office@forgehandyman.com";
    await scheduleJob({ jobId: "job-1", startsAt: START, endsAt: END, actor: ACTOR, now: NOW });
    expect(google.createBookingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ subject: "office@forgehandyman.com" }),
    );
  });

  it("releases the claimed slot and books nothing when the calendar write fails", async () => {
    google.createBookingEvent.mockRejectedValue(new Error("unauthorized_client"));
    const res = await scheduleJob({ jobId: "job-1", startsAt: START, endsAt: END, actor: ACTOR, now: NOW });
    expect(res.ok).toBe(false);
    expect(data.releaseSlot).toHaveBeenCalledWith("appt-1");
    expect(data.updateRowByJobId).not.toHaveBeenCalled();
    expect(data.appendAuditRow).not.toHaveBeenCalled();
  });

  it("refuses a job that already has a live appointment, or one too far along", async () => {
    data.getAppointmentByJobId.mockResolvedValueOnce({ startsAt: START, endsAt: END });
    expect((await scheduleJob({ jobId: "job-1", startsAt: START, endsAt: END, actor: ACTOR, now: NOW })).ok).toBe(false);
    data.findRowByJobId.mockResolvedValueOnce({ row: { status: "Complete" } });
    expect((await scheduleJob({ jobId: "job-1", startsAt: START, endsAt: END, actor: ACTOR, now: NOW })).ok).toBe(false);
    expect(data.claimSlot).not.toHaveBeenCalled();
  });

  it("says the time was just taken when the claim loses the race", async () => {
    data.claimSlot.mockResolvedValue(null);
    const res = await scheduleJob({ jobId: "job-1", startsAt: START, endsAt: END, actor: ACTOR, now: NOW });
    expect(res).toEqual({ ok: false, error: "That time was just taken. Pick another time." });
    expect(google.createBookingEvent).not.toHaveBeenCalled();
  });
});

describe("performCancellation: deletes the event from the calendar that holds it", () => {
  const appt = (source: string) => ({
    id: "appt-1",
    jobId: "",
    technicianId: "tech-1",
    startsAt: START,
    endsAt: END,
    googleEventId: "evt-1",
    source,
  });

  it("an admin-scheduled appointment's event is on the operations calendar", async () => {
    data.cancelAppointment.mockResolvedValue(appt("admin"));
    await performCancellation("appt-1", ACTOR);
    expect(google.deleteBookingEvent).toHaveBeenCalledWith({ subject: "operations@forgehandyman.com", eventId: "evt-1" });
    expect(data.getTechnicianById).not.toHaveBeenCalled();
  });

  it("a self-serve booking's event is on the technician's calendar", async () => {
    data.cancelAppointment.mockResolvedValue(appt("self-serve"));
    data.getTechnicianById.mockResolvedValue({ calendarEmail: "david@forgehandyman.com" });
    await performCancellation("appt-1", ACTOR);
    expect(google.deleteBookingEvent).toHaveBeenCalledWith({ subject: "david@forgehandyman.com", eventId: "evt-1" });
  });
});
