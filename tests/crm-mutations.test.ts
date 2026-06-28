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
}));

vi.mock("@/lib/data", () => data);
vi.mock("@/lib/security/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { createCustomer, moveJobStatus } from "@/lib/crm/mutations";

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
});

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
