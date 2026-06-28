"use server";

import { revalidatePath } from "next/cache";
import {
  rateLimitAdmin,
  requireAdmin,
  type ActionResult,
} from "@/lib/admin/guard";
import { moveJobStatus } from "@/lib/crm/mutations";
import { adminActor } from "@/lib/data/activity-actions";

// Move a deal between pipeline stages from the board (drag-drop or move menu).
// A thin UI wrapper over the shared moveJobStatus core — the SAME code path the
// job-page status dropdown and a future MCP server use. The state-machine guard,
// validation, and activity logging live in the core (lib/crm/mutations.ts); this
// adds the admin gate, rate limit, and cache revalidation.
export async function moveDealAction(
  jobId: string,
  newStatus: string,
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { ok: false, error: "Not authorized" };
  if (!(await rateLimitAdmin(auth.email))) {
    return { ok: false, error: "Too many moves at once — give it a moment." };
  }
  const res = await moveJobStatus({
    jobId,
    newStatus,
    actor: adminActor(auth.email),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/admin/pipeline");
  revalidatePath("/admin");
  revalidatePath(`/admin/jobs/${jobId}`);
  return { ok: true, message: res.message };
}
