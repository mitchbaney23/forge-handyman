"use server";

import { revalidatePath } from "next/cache";
import {
  rateLimitAdmin,
  requireAdmin,
} from "@/lib/admin/guard";
import { crmEnabled } from "@/lib/data";
import { createCustomer } from "@/lib/crm/mutations";
import { adminActor } from "@/lib/data/activity-actions";
import type {
  CreateCustomerActionResult,
  CreateCustomerInput,
} from "./form-types";

// Thin UI wrapper over the shared createCustomer core (lib/crm/mutations.ts):
// admin gate + rate-limit + revalidate. Validation, duplicate detection, and
// activity logging live in the core — the same path a future MCP add_customer
// tool would call.
export async function createCustomerAction(
  input: CreateCustomerInput,
): Promise<CreateCustomerActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  // Customers are a Postgres-only surface (no sheet table). The page already
  // gates the button on crmEnabled(); this is the defense-in-depth backstop.
  if (!crmEnabled()) {
    return { ok: false, error: "Adding customers requires the Postgres backend." };
  }

  const wantsDeal = Boolean(input.deal);
  if (wantsDeal && (input.deal?.serviceType ?? "").trim() === "") {
    return { ok: false, error: "Pick a service for the deal, or turn the deal off." };
  }

  const res = await createCustomer({
    profile: {
      name: input.name,
      phone: input.phone,
      email: input.email,
      notes: input.notes,
    },
    initialDeal: wantsDeal
      ? {
          serviceType: input.deal!.serviceType,
          address: input.deal!.address,
          description: input.deal!.description,
          preferredDate: input.deal!.preferredDate,
          urgency: input.deal!.urgency,
        }
      : undefined,
    actor: adminActor(auth.email),
  });

  if (!res.ok) {
    return { ok: false, error: res.error, duplicateId: res.duplicate?.existingId };
  }

  revalidatePath("/admin/customers");
  if (res.jobId) revalidatePath("/admin/pipeline");
  return {
    ok: true,
    customerId: res.customerId,
    jobId: res.jobId,
    message: res.message,
  };
}
