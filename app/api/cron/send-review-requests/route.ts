import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import {
  SERVICE_LABEL_BY_CODE,
  type ServiceCategoryCode,
} from "@/lib/constants";
import { sendReviewRequestEmail } from "@/lib/email/review-request";
import { logger, maskEmail } from "@/lib/security/logger";
import {
  listJobs,
  updateRowByJobId,
  type JobRow,
} from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const COMPLETED_STATUS = "Complete";
const MIN_AGE_HOURS = 4;
const MAX_AGE_HOURS = 72;

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

function extractCity(address: string): string | undefined {
  if (!address) return undefined;
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  while (
    parts.length > 0 &&
    /^(USA|U\.S\.A\.|United States|US|U\.S\.)$/i.test(parts[parts.length - 1])
  ) {
    parts.pop();
  }
  if (parts.length === 0) return undefined;
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) {
    return /^\d/.test(parts[0]) ? parts[1] : parts[0];
  }
  return parts[0];
}

function deriveServiceLabel(row: JobRow): string {
  const categories = (row.service_categories || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ServiceCategoryCode[];
  if (categories.length === 1) {
    return SERVICE_LABEL_BY_CODE[categories[0]] ?? row.service_type ?? "project";
  }
  if (categories.length >= 2) return "punch list";
  const code = row.service_type as ServiceCategoryCode;
  return SERVICE_LABEL_BY_CODE[code] ?? row.service_type ?? "project";
}

interface AttemptResult {
  jobId: string;
  status: "sent" | "skipped" | "failed";
  reason?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(request)) return unauthorized();
  if (process.env.AUTOMATIONS_DISABLED === "true") {
    logger.info("send-review-requests: AUTOMATIONS_DISABLED, skipping");
    return NextResponse.json({ ok: true, skipped: true });
  }

  const now = Date.now();
  const minAge = MIN_AGE_HOURS * 60 * 60 * 1000;
  const maxAge = MAX_AGE_HOURS * 60 * 60 * 1000;

  let jobs: JobRow[];
  try {
    jobs = await listJobs();
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "cron-review-requests", step: "listJobs" } });
    logger.error({ err }, "send-review-requests: listJobs failed");
    return NextResponse.json({ ok: false, error: "Failed to list jobs" }, { status: 500 });
  }

  const eligible = jobs.filter((row) => {
    if ((row.status || "").trim() !== COMPLETED_STATUS) return false;
    if ((row.opt_out || "").trim().toLowerCase() === "true") return false;
    if ((row.review_sent_at || "").trim()) return false;
    const completed = row.complete_date ? new Date(row.complete_date).getTime() : 0;
    if (!completed) return false;
    const age = now - completed;
    return age >= minAge && age <= maxAge;
  });

  const results: AttemptResult[] = [];
  for (const row of eligible) {
    if (!row.job_id || !row.email) {
      results.push({
        jobId: row.job_id || `(row ${row.rowNumber})`,
        status: "skipped",
        reason: "Missing job_id or email",
      });
      continue;
    }
    try {
      await sendReviewRequestEmail({
        toEmail: row.email,
        toName: row.name || "",
        serviceLabel: deriveServiceLabel(row),
        customerCity: extractCity(row.address || ""),
      });
      const sentAt = new Date().toISOString();
      const nextCount =
        (Number(row.review_send_count || "0") || 0) + 1;
      await updateRowByJobId(row.job_id, {
        review_sent_at: sentAt,
        review_send_count: String(nextCount),
      });
      logger.info(
        {
          jobId: row.job_id,
          maskedEmail: maskEmail(row.email),
          sendCount: nextCount,
        },
        "send-review-requests: sent",
      );
      results.push({ jobId: row.job_id, status: "sent" });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: "cron-review-requests", step: "send" },
        extra: { jobId: row.job_id },
      });
      logger.error(
        { err, jobId: row.job_id, maskedEmail: maskEmail(row.email) },
        "send-review-requests: send failed",
      );
      results.push({
        jobId: row.job_id,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;

  logger.info(
    {
      scanned: jobs.length,
      eligible: eligible.length,
      sent,
      failed,
      skipped,
    },
    "send-review-requests: cron run complete",
  );

  return NextResponse.json({
    ok: true,
    scanned: jobs.length,
    eligible: eligible.length,
    sent,
    failed,
    skipped,
    results,
  });
}
