import type { ServiceCategoryCode } from "@/lib/constants";
import { listJobs, type JobRow } from "@/lib/data";
import { pickTemplate, type NudgeTemplate } from "@/lib/templates/seasonal";

const NUDGE_ELIGIBLE_AFTER_DAYS = 180;
const NUDGE_COOLDOWN_DAYS = 180;

export interface NudgeCandidate {
  email: string; // normalized lowercase
  name: string;
  lastJobDate: string; // ISO of most recent complete_date
  priorJobCount: number;
  jobIds: string[]; // every job_id for this email (for sheet update after send)
  priorCategories: ServiceCategoryCode[];
  template: NudgeTemplate;
}

function daysAgo(iso: string): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / (24 * 60 * 60 * 1000);
}

export async function findNudgeCandidates(): Promise<NudgeCandidate[]> {
  const all = await listJobs();
  // Group by normalized email.
  const byEmail = new Map<string, JobRow[]>();
  for (const row of all) {
    const email = (row.email || "").trim().toLowerCase();
    if (!email) continue;
    const list = byEmail.get(email) ?? [];
    list.push(row);
    byEmail.set(email, list);
  }

  const candidates: NudgeCandidate[] = [];
  for (const [email, rows] of byEmail.entries()) {
    // If any row is opted out, skip the customer entirely.
    if (
      rows.some((r) => (r.opt_out || "").trim().toLowerCase() === "true")
    ) {
      continue;
    }
    // Need at least one completed job.
    const completed = rows.filter(
      (r) => (r.status || "").trim() === "Complete" && Boolean(r.complete_date),
    );
    if (completed.length === 0) continue;

    // Sort completed by complete_date desc — most recent first.
    completed.sort((a, b) =>
      (b.complete_date || "").localeCompare(a.complete_date || ""),
    );
    const lastJob = completed[0];
    const lastJobDate = lastJob.complete_date || "";
    if (daysAgo(lastJobDate) < NUDGE_ELIGIBLE_AFTER_DAYS) continue;

    // Skip if any row in the group had a nudge sent within the cooldown.
    const lastNudge = rows
      .map((r) => r.seasonal_nudge_last_sent || "")
      .filter(Boolean)
      .sort()
      .reverse()[0];
    if (lastNudge && daysAgo(lastNudge) < NUDGE_COOLDOWN_DAYS) continue;

    // Prior categories from most recent job's selections (or service_type fallback).
    const categories =
      ((lastJob.service_categories || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as ServiceCategoryCode[]).length > 0
        ? ((lastJob.service_categories || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean) as ServiceCategoryCode[])
        : [lastJob.service_type as ServiceCategoryCode];

    const template = pickTemplate(lastJob.name || "", categories);

    candidates.push({
      email,
      name: lastJob.name || "",
      lastJobDate,
      priorJobCount: completed.length,
      jobIds: rows.map((r) => r.job_id || "").filter(Boolean),
      priorCategories: categories,
      template,
    });
  }

  // Stalest first.
  candidates.sort((a, b) => a.lastJobDate.localeCompare(b.lastJobDate));
  return candidates;
}
