import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { logger, maskEmail } from "@/lib/security/logger";
import {
  appendAuditRow,
  listActivitiesForJob,
  listAppointmentsInRange,
  listJobs,
  type JobRow,
} from "@/lib/data";
import { getBackend } from "@/lib/data/backend";
import { getStripe } from "@/lib/stripe/client";
import {
  alreadyNudged,
  buildDigestSections,
  digestIsEmpty,
  extractQuoteMeta,
  findDrift,
  isInNudgeWindow,
  isOptedOut,
  isReminderDay,
  quoteExpiryMs,
  type DriftFinding,
  type MoneyEvent,
  type QuoteMeta,
} from "@/lib/automation/lifecycle";
import { ACTIONS } from "@/lib/data/activity-actions";
import { sendAppointmentReminderEmail } from "@/lib/email/appointment-reminder";
import { sendQuoteNudgeEmail } from "@/lib/email/quote-nudge";
import { sendOwnerDigestEmail } from "@/lib/email/owner-digest";

// Daily lifecycle cron (Hobby = daily-only; scheduled 13:00 UTC ≈ 9 AM ET in
// vercel.json). Four independent checks — each isolated in its own try/catch
// so one failing never starves the others:
//   1. Day-before appointment reminders to customers.
//   2. Quote-expiry nudges (once per quote, 24-48h before the promised expiry).
//   3. Stripe reconciliation backstop (drift between Stripe events and job
//      status — report-only, surfaced to Sentry + the digest).
//   4. Stalled-deal digest to the owner (only when there's something to act on).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    logger.error("lifecycle-cron: CRON_SECRET not configured");
    return false;
  }
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

interface CheckSummary {
  sent?: number;
  skipped?: number;
  failed?: number;
  drift?: number;
  error?: string;
}

function extractJobIdFromMetadata(
  metadata: Stripe.Metadata | null | undefined,
): string | null {
  const value = metadata?.jobId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function runReminders(
  rowsByJobId: Map<string, JobRow>,
  now: Date,
): Promise<CheckSummary> {
  const summary: CheckSummary = { sent: 0, skipped: 0, failed: 0 };
  // 52h forward covers all of "tomorrow ET" from any run time; the exact
  // bucketing is isReminderDay's job.
  const appointments = await listAppointmentsInRange(
    now.toISOString(),
    new Date(now.getTime() + 52 * HOUR_MS).toISOString(),
  );
  for (const appt of appointments) {
    if (appt.status !== "Booked") continue;
    if (!isReminderDay(appt.startsAt, now)) continue;
    const row = rowsByJobId.get(appt.jobId);
    if (!row || !row.email || isOptedOut(row) || row.status === "Cancelled") {
      summary.skipped! += 1;
      continue;
    }
    try {
      await sendAppointmentReminderEmail({
        toEmail: row.email,
        toName: row.name || "",
        serviceType: row.service_type || "service",
        appointmentId: appt.id,
        startsAt: appt.startsAt,
        endsAt: appt.endsAt,
      });
      await appendAuditRow({
        actor: "lifecycle-cron",
        action: ACTIONS.REMINDER_SENT,
        target: appt.jobId,
        jobId: appt.jobId,
        after: JSON.stringify({ appointmentId: appt.id, startsAt: appt.startsAt }),
      });
      summary.sent! += 1;
      logger.info(
        { jobId: appt.jobId, maskedEmail: maskEmail(row.email) },
        "lifecycle-cron: reminder sent",
      );
    } catch (err) {
      summary.failed! += 1;
      Sentry.captureException(err, {
        tags: { route: "lifecycle-cron", step: "reminder" },
        extra: { jobId: appt.jobId },
      });
      logger.error({ err, jobId: appt.jobId }, "lifecycle-cron: reminder failed");
    }
  }
  return summary;
}

async function loadQuoteMeta(
  quotedRows: JobRow[],
): Promise<Map<string, { meta: QuoteMeta; nudged: boolean }>> {
  const out = new Map<string, { meta: QuoteMeta; nudged: boolean }>();
  for (const row of quotedRows) {
    const jobId = row.job_id || "";
    if (!jobId) continue;
    const activities = await listActivitiesForJob(jobId);
    const meta = extractQuoteMeta(activities);
    if (meta) out.set(jobId, { meta, nudged: alreadyNudged(activities) });
  }
  return out;
}

async function runQuoteNudges(
  quotedRows: JobRow[],
  metaByJobId: Map<string, { meta: QuoteMeta; nudged: boolean }>,
  now: Date,
): Promise<CheckSummary> {
  const summary: CheckSummary = { sent: 0, skipped: 0, failed: 0 };
  for (const row of quotedRows) {
    const jobId = row.job_id || "";
    const entry = metaByJobId.get(jobId);
    if (!entry) continue;
    if (entry.nudged || !isInNudgeWindow(entry.meta, now)) continue;
    if (!row.email || isOptedOut(row)) {
      summary.skipped! += 1;
      continue;
    }
    try {
      const expiry = quoteExpiryMs(entry.meta);
      await sendQuoteNudgeEmail({
        toEmail: row.email,
        toName: row.name || "",
        serviceType: row.service_type || "job",
        expiresAt: Number.isFinite(expiry) ? new Date(expiry).toISOString() : "",
        paymentLinkUrl: entry.meta.paymentLinkUrl,
        depositCents: entry.meta.depositCents,
      });
      // The durable once-only guard: alreadyNudged() reads this back.
      await appendAuditRow({
        actor: "lifecycle-cron",
        action: ACTIONS.QUOTE_NUDGE_SENT,
        target: jobId,
        jobId,
        after: JSON.stringify({ expiresAt: entry.meta.expiresAt }),
      });
      summary.sent! += 1;
      logger.info(
        { jobId, maskedEmail: maskEmail(row.email) },
        "lifecycle-cron: quote nudge sent",
      );
    } catch (err) {
      summary.failed! += 1;
      Sentry.captureException(err, {
        tags: { route: "lifecycle-cron", step: "quote-nudge" },
        extra: { jobId },
      });
      logger.error({ err, jobId }, "lifecycle-cron: quote nudge failed");
    }
  }
  return summary;
}

// Report-only backstop: recompute what the last ~25h of Stripe money events
// imply about job status and flag mismatches. Catches a lost webhook (the
// exact silent failure the two-phase idempotency narrows but can't erase).
async function runReconciliation(
  rowsByJobId: Map<string, JobRow>,
): Promise<{ summary: CheckSummary; findings: DriftFinding[] }> {
  const stripe = getStripe();
  const createdGte = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
  // Auto-paginate past the 100-per-page limit; the hard cap keeps a runaway
  // event day from eating the route's 60s budget. Cap hit => warn, never
  // silently truncate.
  const RECON_EVENT_CAP = 500;
  const rawEvents: Stripe.Event[] = [];
  await stripe.events
    .list({
      types: ["checkout.session.completed", "charge.refunded"],
      created: { gte: createdGte },
      limit: 100,
    })
    .autoPagingEach((event) => {
      rawEvents.push(event);
      return rawEvents.length < RECON_EVENT_CAP;
    });
  if (rawEvents.length >= RECON_EVENT_CAP) {
    logger.warn(
      { cap: RECON_EVENT_CAP },
      "lifecycle-cron: reconciliation event cap hit — window not fully checked",
    );
  }

  const moneyEvents: MoneyEvent[] = [];
  for (const event of rawEvents) {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      moneyEvents.push({
        type: "checkout.session.completed",
        jobId: extractJobIdFromMetadata(session.metadata),
      });
    } else if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      let jobId = extractJobIdFromMetadata(charge.metadata);
      if (!jobId) {
        const piId =
          typeof charge.payment_intent === "string"
            ? charge.payment_intent
            : charge.payment_intent?.id ?? null;
        if (piId) {
          try {
            const pi = await stripe.paymentIntents.retrieve(piId);
            jobId = extractJobIdFromMetadata(pi.metadata);
          } catch {
            // Unresolvable here is fine — the webhook already Sentry-flags it.
          }
        }
      }
      moneyEvents.push({
        type: "charge.refunded",
        jobId,
        fullyRefunded: charge.refunded === true,
      });
    }
  }

  const statusByJobId = new Map<string, string>();
  for (const [jobId, row] of rowsByJobId) statusByJobId.set(jobId, row.status || "");
  const findings = findDrift(moneyEvents, statusByJobId);

  for (const finding of findings) {
    Sentry.captureMessage("Stripe/database drift detected", {
      level: "warning",
      tags: { route: "lifecycle-cron", kind: finding.kind },
      extra: { jobId: finding.jobId, detail: finding.detail },
    });
    logger.warn(
      { jobId: finding.jobId, kind: finding.kind },
      "lifecycle-cron: drift detected",
    );
  }
  return { summary: { drift: findings.length }, findings };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(request)) return unauthorized();

  if (getBackend() !== "postgres") {
    // Appointments, activities, and the payments ledger are postgres-only.
    return NextResponse.json({ ok: true, skipped: "sheet-mode" });
  }

  const now = new Date();
  const results: Record<string, CheckSummary> = {};

  let rows: JobRow[] = [];
  try {
    rows = await listJobs();
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "lifecycle-cron", step: "load" } });
    logger.error({ err }, "lifecycle-cron: listJobs failed — aborting run");
    return NextResponse.json({ ok: false, error: "data-load-failed" }, { status: 500 });
  }
  const rowsByJobId = new Map<string, JobRow>();
  for (const row of rows) {
    if (row.job_id) rowsByJobId.set(row.job_id, row);
  }

  // 1. Appointment reminders.
  try {
    results.reminders = await runReminders(rowsByJobId, now);
  } catch (err) {
    results.reminders = { error: "check-failed" };
    Sentry.captureException(err, { tags: { route: "lifecycle-cron", step: "reminders" } });
    logger.error({ err }, "lifecycle-cron: reminders check failed");
  }

  // 2. Quote nudges (meta reused by the digest below). loadQuoteMeta is one
  // activities query per quoted job — cap it so a pathological backlog can't
  // blow the route's 60s budget (Hobby's maxDuration ceiling). Newest quotes
  // win the slots; a hit cap is warned, never silent.
  const QUOTE_META_LIMIT = 50;
  const allQuoted = rows.filter((r) => (r.status || "").trim() === "Quoted");
  const quotedRows = [...allQuoted]
    .sort((a, b) => (b.submitted_at || "").localeCompare(a.submitted_at || ""))
    .slice(0, QUOTE_META_LIMIT);
  if (allQuoted.length > QUOTE_META_LIMIT) {
    logger.warn(
      { quoted: allQuoted.length, cap: QUOTE_META_LIMIT },
      "lifecycle-cron: quote-meta cap hit — oldest quotes skipped this run",
    );
  }
  let metaByJobId = new Map<string, { meta: QuoteMeta; nudged: boolean }>();
  try {
    metaByJobId = await loadQuoteMeta(quotedRows);
    results.quoteNudges = await runQuoteNudges(quotedRows, metaByJobId, now);
  } catch (err) {
    results.quoteNudges = { error: "check-failed" };
    Sentry.captureException(err, { tags: { route: "lifecycle-cron", step: "quote-nudges" } });
    logger.error({ err }, "lifecycle-cron: quote-nudge check failed");
  }

  // 3. Stripe reconciliation backstop.
  let drift: DriftFinding[] = [];
  try {
    const recon = await runReconciliation(rowsByJobId);
    results.reconciliation = recon.summary;
    drift = recon.findings;
  } catch (err) {
    results.reconciliation = { error: "check-failed" };
    Sentry.captureException(err, { tags: { route: "lifecycle-cron", step: "reconciliation" } });
    logger.error({ err }, "lifecycle-cron: reconciliation check failed");
  }

  // 4. Owner digest — only when there's something to act on.
  try {
    const quoteMetaOnly = new Map<string, QuoteMeta>();
    for (const [jobId, entry] of metaByJobId) quoteMetaOnly.set(jobId, entry.meta);
    const sections = buildDigestSections(rows, quoteMetaOnly, now);
    if (!digestIsEmpty(sections) || drift.length > 0) {
      await sendOwnerDigestEmail({ sections, drift, now });
      results.digest = { sent: 1 };
    } else {
      results.digest = { skipped: 1 };
    }
  } catch (err) {
    results.digest = { error: "check-failed" };
    Sentry.captureException(err, { tags: { route: "lifecycle-cron", step: "digest" } });
    logger.error({ err }, "lifecycle-cron: digest failed");
  }

  logger.info({ results }, "lifecycle-cron: run complete");
  return NextResponse.json({ ok: true, results });
}
