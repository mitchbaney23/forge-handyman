import { beforeEach, describe, expect, it, vi } from "vitest";

// Unit tests for the shared CRM mutation core (lib/crm/mutations.ts) — the one
// code path the admin UI server actions AND a future MCP server both call. The
// data layer (@/lib/data) is mocked so these assert the CORE's guarantees:
//   - moveJobStatus honors the status state machine (real canAdminTransition),
//     never hand-sets "Complete", validates the status set, and logs
//     job.status_changed with the caller's actor.
//   - createCustomer validates with the real shared zod schemas, blocks a bare
//     duplicate (surfacing the existing id), and links a deal to an existing
//     customer via appendContactRow.
// status-machine + security/zod are REAL (pure) — only the IO boundary is faked.

const data = vi.hoisted(() => ({
  findRowByJobId: vi.fn(),
  updateRowByJobId: vi.fn(),
  appendAuditRow: vi.fn(),
  appendContactRow: vi.fn(),
  findCustomerByEmail: vi.fn(),
  insertCustomer: vi.fn(),
  updateCustomerNotes: vi.fn(),
  getCustomerById: vi.fn(),
  insertJobForCustomer: vi.fn(),
  updateCustomerContact: vi.fn(),
}));
const schedule = vi.hoisted(() => ({
  checkScheduleWindow: vi.fn(),
  scheduleJob: vi.fn(),
}));

vi.mock("@/lib/data", () => data);
vi.mock("@/lib/crm/schedule", () => schedule);
vi.mock("@/lib/security/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  adjustBalance,
  balanceLinkIdsFrom,
  createCustomer,
  createJobForCustomer,
  moveJobStatus,
  updateCustomerContact,
} from "@/lib/crm/mutations";

const ACTOR = "admin:owner@forge.test";

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults; individual tests override.
  data.findRowByJobId.mockResolvedValue({ row: { status: "New" } });
  data.updateRowByJobId.mockResolvedValue({ updated: true });
  data.appendAuditRow.mockResolvedValue(undefined);
  data.appendContactRow.mockResolvedValue({ rowNumber: 0 });
  data.findCustomerByEmail.mockResolvedValue(null);
  data.insertCustomer.mockResolvedValue({ id: "cust-new" });
  data.updateCustomerNotes.mockResolvedValue({ updated: true });
  data.getCustomerById.mockResolvedValue(customer());
  data.insertJobForCustomer.mockResolvedValue({ jobId: "job-new" });
  data.updateCustomerContact.mockResolvedValue({ ok: true, jobsUpdated: 2 });
  schedule.checkScheduleWindow.mockResolvedValue({ ok: true, technician: { id: "tech-1" } });
  schedule.scheduleJob.mockResolvedValue({
    ok: true,
    appointmentId: "appt-1",
    startsAt: "2026-10-20T14:00:00.000Z",
    endsAt: "2026-10-20T16:00:00.000Z",
    calendar: "operations@forgehandyman.com",
    message: "Scheduled for Tue, Oct 20, 10:00 AM–12:00 PM on the operations@forgehandyman.com calendar.",
  });
});

function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: "cust-1",
    name: "Jane Doe",
    phone: "9195550142",
    email: "jane@example.com",
    anonymized: false,
    jobs: [{ job_id: "job-old" }],
    properties: [],
    ...overrides,
  };
}

describe("moveJobStatus", () => {
  it("writes a valid transition, logs it, and passes the actor through", async () => {
    data.findRowByJobId.mockResolvedValue({ row: { status: "New" } });

    const res = await moveJobStatus({ jobId: "j1", newStatus: "Quoted", actor: ACTOR });

    expect(res).toEqual({ ok: true, before: "New", after: "Quoted", message: "Status set to Quoted." });
    expect(data.updateRowByJobId).toHaveBeenCalledWith("j1", { status: "Quoted" });
    expect(data.appendAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: ACTOR,
        action: "job.status_changed",
        before: "New",
        after: "Quoted",
        jobId: "j1",
      }),
    );
  });

  it("refuses to hand-set Complete (must go through Mark Complete)", async () => {
    data.findRowByJobId.mockResolvedValue({ row: { status: "In Progress" } });

    const res = await moveJobStatus({ jobId: "j1", newStatus: "Complete", actor: ACTOR });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Mark Complete/i);
    expect(data.updateRowByJobId).not.toHaveBeenCalled();
    expect(data.appendAuditRow).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition (New → In Progress) without writing", async () => {
    data.findRowByJobId.mockResolvedValue({ row: { status: "New" } });

    const res = await moveJobStatus({ jobId: "j1", newStatus: "In Progress", actor: ACTOR });

    expect(res.ok).toBe(false);
    expect(data.updateRowByJobId).not.toHaveBeenCalled();
  });

  it("rejects an unknown status before touching the data layer", async () => {
    const res = await moveJobStatus({ jobId: "j1", newStatus: "Banana", actor: ACTOR });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Invalid status/i);
    expect(data.findRowByJobId).not.toHaveBeenCalled();
  });

  it("returns Job not found when the row is missing", async () => {
    data.findRowByJobId.mockResolvedValue(null);

    const res = await moveJobStatus({ jobId: "nope", newStatus: "Quoted", actor: ACTOR });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/not found/i);
  });

  it("treats a same-status move as a no-op (no write)", async () => {
    data.findRowByJobId.mockResolvedValue({ row: { status: "Booked" } });

    const res = await moveJobStatus({ jobId: "j1", newStatus: "Booked", actor: ACTOR });

    expect(res.ok).toBe(true);
    expect(data.updateRowByJobId).not.toHaveBeenCalled();
    expect(data.appendAuditRow).not.toHaveBeenCalled();
  });
});

describe("createCustomer", () => {
  it("inserts a bare customer with validated + normalized fields", async () => {
    data.findCustomerByEmail.mockResolvedValue(null);
    data.insertCustomer.mockResolvedValue({ id: "cust-1" });

    const res = await createCustomer({
      profile: {
        name: "  Jane Doe ",
        phone: "(919) 555-0142",
        email: "Jane@Example.com",
        notes: "met at market",
      },
      actor: ACTOR,
    });

    expect(res).toMatchObject({ ok: true, customerId: "cust-1" });
    expect(data.insertCustomer).toHaveBeenCalledWith({
      name: "Jane Doe",
      phone: "+19195550142", // E.164 normalized
      email: "jane@example.com", // lowercased/trimmed
      notes: "met at market",
    });
    expect(data.appendContactRow).not.toHaveBeenCalled();
    expect(data.appendAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.created", target: "cust-1", actor: ACTOR }),
    );
  });

  it("blocks a bare duplicate and surfaces the existing id", async () => {
    data.findCustomerByEmail.mockResolvedValue({ id: "existing-7" });

    const res = await createCustomer({
      profile: { name: "Jane", email: "jane@example.com" },
      actor: ACTOR,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.duplicate?.existingId).toBe("existing-7");
    expect(data.insertCustomer).not.toHaveBeenCalled();
  });

  it("creates a customer + first deal via appendContactRow (status New)", async () => {
    // Guard lookup: no existing customer; post-append lookup: resolved id.
    data.findCustomerByEmail
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "cust-9" });

    const res = await createCustomer({
      profile: { name: "Bob", email: "bob@example.com", notes: "new lead" },
      initialDeal: { serviceType: "Drywall, painting, or trim", address: "1 Oak St" },
      actor: ACTOR,
    });

    expect(res.ok).toBe(true);
    expect(data.appendContactRow).toHaveBeenCalledTimes(1);
    const row = data.appendContactRow.mock.calls[0][0];
    expect(row.status).toBe("New");
    expect(row.service_type).toBe("Drywall, painting, or trim");
    expect(row.address).toBe("1 Oak St");
    if (res.ok) {
      expect(res.jobId).toBe(row.job_id); // the generated UUID flows back
      expect(res.customerId).toBe("cust-9");
    }
    // Brand-new customer -> notes stamped once we know the id.
    expect(data.updateCustomerNotes).toHaveBeenCalledWith("cust-9", "new lead");
    expect(data.insertCustomer).not.toHaveBeenCalled();
  });

  it("links a deal to an EXISTING customer without clobbering their notes", async () => {
    // Existing customer found at the guard, and again after append.
    data.findCustomerByEmail.mockResolvedValue({ id: "cust-existing" });

    const res = await createCustomer({
      profile: { name: "Repeat", email: "repeat@example.com", notes: "do not overwrite" },
      initialDeal: { serviceType: "General repair or maintenance" },
      actor: ACTOR,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.message).toMatch(/existing customer/i);
    expect(data.appendContactRow).toHaveBeenCalledTimes(1);
    expect(data.updateCustomerNotes).not.toHaveBeenCalled(); // existing -> never clobbered
  });

  it("requires a name", async () => {
    const res = await createCustomer({ profile: { name: "   " }, actor: ACTOR });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/name/i);
  });

  it("rejects an invalid phone", async () => {
    const res = await createCustomer({
      profile: { name: "Jane", phone: "abc" },
      actor: ACTOR,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/phone/i);
    expect(data.insertCustomer).not.toHaveBeenCalled();
  });
});

describe("adjustBalance", () => {
  it("writes the new balance and logs before/after in dollars with the reason", async () => {
    data.findRowByJobId.mockResolvedValue({ row: { status: "Booked", balance_owed_cents: "13500" } });

    const res = await adjustBalance({ jobId: "j1", newBalanceCents: 1000, reason: "  Job took less time than quoted  ", actor: ACTOR });

    expect(res).toEqual({ ok: true, beforeCents: 13500, afterCents: 1000, message: "Balance owed changed from $135.00 to $10.00." });
    expect(data.updateRowByJobId).toHaveBeenCalledWith("j1", { balance_owed_cents: "1000" });
    expect(data.appendAuditRow).toHaveBeenCalledWith({
      actor: ACTOR,
      action: "balance.adjusted",
      target: "j1",
      jobId: "j1",
      before: "$135.00",
      after: "$10.00",
      notes: "Job took less time than quoted",
    });
  });

  it("treats an unchanged balance as a no-op (no write, no activity)", async () => {
    data.findRowByJobId.mockResolvedValue({ row: { status: "Booked", balance_owed_cents: "1000" } });
    const res = await adjustBalance({ jobId: "j1", newBalanceCents: 1000, reason: "same", actor: ACTOR });
    expect(res).toMatchObject({ ok: true, beforeCents: 1000, afterCents: 1000 });
    expect(data.updateRowByJobId).not.toHaveBeenCalled();
    expect(data.appendAuditRow).not.toHaveBeenCalled();
  });

  it("allows zeroing a balance collected outside the app", async () => {
    data.findRowByJobId.mockResolvedValue({ row: { status: "Complete", balance_owed_cents: "5000" } });
    const res = await adjustBalance({ jobId: "j1", newBalanceCents: 0, reason: "Paid cash on site", actor: ACTOR });
    expect(res).toMatchObject({ ok: true, afterCents: 0 });
    expect(data.updateRowByJobId).toHaveBeenCalledWith("j1", { balance_owed_cents: "0" });
  });

  it("rejects negative, fractional or oversized amounts and a missing reason before reading the job", async () => {
    for (const bad of [
      { newBalanceCents: -1, reason: "x y z" },
      { newBalanceCents: 10.5, reason: "x y z" },
      { newBalanceCents: 5_000_001, reason: "x y z" },
      { newBalanceCents: 1000, reason: "  " },
      { newBalanceCents: 1000, reason: "no" },
    ]) {
      const res = await adjustBalance({ jobId: "j1", actor: ACTOR, ...bad });
      expect(res.ok).toBe(false);
    }
    expect(data.findRowByJobId).not.toHaveBeenCalled();
    expect(data.updateRowByJobId).not.toHaveBeenCalled();
  });

  it("returns Job not found when the row is missing", async () => {
    data.findRowByJobId.mockResolvedValue(null);
    expect(await adjustBalance({ jobId: "nope", newBalanceCents: 1000, reason: "ran short", actor: ACTOR })).toEqual({ ok: false, error: "Job not found" });
  });
});

describe("balanceLinkIdsFrom", () => {
  it("collects balance-link ids from either activity shape, de-duplicated, ignoring other actions", () => {
    expect(
      balanceLinkIdsFrom([
        { action: "balance_link.created", data: { after: { paymentLinkId: "plink_a", amountCents: 13500 } } },
        { action: "balance_link.created", after: JSON.stringify({ paymentLinkId: "plink_b" }) },
        { action: "balance_link.created", after: JSON.stringify({ paymentLinkId: "plink_a" }) },
        { action: "payment_link.created", after: JSON.stringify({ paymentLinkId: "plink_quote" }) },
        { action: "balance_link.created", after: "not json" },
      ]),
    ).toEqual(["plink_a", "plink_b"]);
    expect(balanceLinkIdsFrom([])).toEqual([]);
  });
});

describe("updateCustomerContact", () => {
  it("writes only what changed, logs the field names (not the values), and reports the jobs", async () => {
    const res = await updateCustomerContact({
      customerId: "cust-1",
      changes: { name: "Jane Doe", phone: "(919) 555-0199", email: " Jane.New@Example.com " },
      actor: ACTOR,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.changed).toEqual(["phone", "email"]);
      expect(res.message).toBe("Saved the new phone and email. Also updated on their 2 jobs.");
    }
    const [id, patch] = data.updateCustomerContact.mock.calls[0];
    expect(id).toBe("cust-1");
    expect(patch).not.toHaveProperty("name");
    expect(patch.email).toBe("jane.new@example.com");
    const audit = data.appendAuditRow.mock.calls[0][0];
    expect(audit).toMatchObject({ actor: ACTOR, action: "customer.updated", target: "cust-1" });
    expect(JSON.stringify(audit)).not.toContain("jane.new@example.com");
    expect(JSON.stringify(audit)).not.toContain("555");
  });

  it("is a no-op when nothing differs", async () => {
    const res = await updateCustomerContact({
      customerId: "cust-1",
      changes: { name: "Jane Doe", phone: "9195550142", email: "JANE@example.com" },
      actor: ACTOR,
    });
    expect(res).toMatchObject({ ok: true, changed: [], message: "Nothing changed." });
    expect(data.updateCustomerContact).not.toHaveBeenCalled();
    expect(data.appendAuditRow).not.toHaveBeenCalled();
  });

  it("refuses an email another customer already has, pointing at them", async () => {
    data.findCustomerByEmail.mockResolvedValue({ id: "cust-other" });
    const res = await updateCustomerContact({
      customerId: "cust-1",
      changes: { email: "taken@example.com" },
      actor: ACTOR,
    });
    expect(res).toMatchObject({ ok: false, duplicate: { existingId: "cust-other" } });
    expect(data.updateCustomerContact).not.toHaveBeenCalled();
  });

  it("lets a customer clear their email", async () => {
    const res = await updateCustomerContact({ customerId: "cust-1", changes: { email: "" }, actor: ACTOR });
    expect(res).toMatchObject({ ok: true, changed: ["email"] });
    expect(data.updateCustomerContact).toHaveBeenCalledWith("cust-1", { email: "" });
    expect(data.findCustomerByEmail).not.toHaveBeenCalled();
  });

  it("rejects a blank name, a bad phone, and an anonymized customer", async () => {
    expect((await updateCustomerContact({ customerId: "cust-1", changes: { name: "  " }, actor: ACTOR })).ok).toBe(false);
    expect((await updateCustomerContact({ customerId: "cust-1", changes: { phone: "12" }, actor: ACTOR })).ok).toBe(false);
    data.getCustomerById.mockResolvedValue(customer({ anonymized: true }));
    const res = await updateCustomerContact({ customerId: "cust-1", changes: { name: "X" }, actor: ACTOR });
    expect(res.ok).toBe(false);
    expect(data.updateCustomerContact).not.toHaveBeenCalled();
  });
});

describe("createJobForCustomer", () => {
  it("adds a job at New under the customer's id with their current contact details", async () => {
    const res = await createJobForCustomer({
      customerId: "cust-1",
      job: { serviceType: "TV mounting", address: " 12 Oak St ", description: "65 inch" },
      actor: ACTOR,
    });

    expect(res).toMatchObject({ ok: true, jobId: "job-new", scheduled: null });
    const [customerId, row] = data.insertJobForCustomer.mock.calls[0];
    expect(customerId).toBe("cust-1");
    expect(row).toMatchObject({
      name: "Jane Doe",
      phone: "9195550142",
      email: "jane@example.com",
      address: "12 Oak St",
      service_type: "TV mounting",
      status: "New",
      is_returning_customer: "true",
      prior_job_count: "1",
    });
    expect(data.appendAuditRow).toHaveBeenCalledWith(
      expect.objectContaining({ action: "job.created", jobId: "job-new", actor: ACTOR }),
    );
    expect(schedule.scheduleJob).not.toHaveBeenCalled();
  });

  it("checks the time BEFORE writing the job, so a taken slot leaves nothing behind", async () => {
    schedule.checkScheduleWindow.mockResolvedValue({ ok: false, error: "That overlaps another booking." });
    const res = await createJobForCustomer({
      customerId: "cust-1",
      job: { serviceType: "TV mounting" },
      schedule: { startsAt: "2026-10-20T14:00:00.000Z", endsAt: "2026-10-20T16:00:00.000Z" },
      actor: ACTOR,
    });
    expect(res).toEqual({ ok: false, error: "That overlaps another booking." });
    expect(data.insertJobForCustomer).not.toHaveBeenCalled();
  });

  it("schedules the new job when a time is given", async () => {
    const res = await createJobForCustomer({
      customerId: "cust-1",
      job: { serviceType: "TV mounting" },
      schedule: { startsAt: "2026-10-20T14:00:00.000Z", endsAt: "2026-10-20T16:00:00.000Z" },
      actor: ACTOR,
    });
    expect(schedule.scheduleJob).toHaveBeenCalledWith({
      jobId: "job-new",
      startsAt: "2026-10-20T14:00:00.000Z",
      endsAt: "2026-10-20T16:00:00.000Z",
      actor: ACTOR,
    });
    expect(res).toMatchObject({
      ok: true,
      scheduled: { calendar: "operations@forgehandyman.com" },
      message: "Job added and scheduled for Tue, Oct 20, 10:00 AM–12:00 PM on the operations@forgehandyman.com calendar.",
    });
  });

  it("keeps the job and says so when scheduling fails after it was created", async () => {
    schedule.scheduleJob.mockResolvedValue({ ok: false, error: "Couldn't add it to the calendar." });
    const res = await createJobForCustomer({
      customerId: "cust-1",
      job: { serviceType: "TV mounting" },
      schedule: { startsAt: "2026-10-20T14:00:00.000Z", endsAt: "2026-10-20T16:00:00.000Z" },
      actor: ACTOR,
    });
    expect(res).toMatchObject({ ok: true, jobId: "job-new", scheduled: null, scheduleError: "Couldn't add it to the calendar." });
  });

  it("requires a service and a real, non-anonymized customer", async () => {
    expect((await createJobForCustomer({ customerId: "cust-1", job: { serviceType: " " }, actor: ACTOR })).ok).toBe(false);
    data.getCustomerById.mockResolvedValue(null);
    expect((await createJobForCustomer({ customerId: "nope", job: { serviceType: "X" }, actor: ACTOR })).ok).toBe(false);
    data.getCustomerById.mockResolvedValue(customer({ anonymized: true }));
    expect((await createJobForCustomer({ customerId: "cust-1", job: { serviceType: "X" }, actor: ACTOR })).ok).toBe(false);
    expect(data.insertJobForCustomer).not.toHaveBeenCalled();
  });
});
