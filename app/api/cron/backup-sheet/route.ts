import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { sendEmailWithAttachments } from "@/lib/email/attachment";
import { logger } from "@/lib/security/logger";
import { exportAllTabsCsv } from "@/lib/sheet/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
}

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret configured — refuse to run in production. Fail closed.
    logger.error("backup-sheet: CRON_SECRET not configured");
    return false;
  }
  const header = request.headers.get("authorization");
  if (!header) return false;
  return header === `Bearer ${secret}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyCronSecret(request)) {
    return unauthorized();
  }

  const startedAt = new Date();

  try {
    const tabs = await exportAllTabsCsv();
    const totalRows = tabs.reduce((sum, t) => sum + t.rowCount, 0);
    const businessEmail = process.env.BUSINESS_EMAIL;
    if (!businessEmail) throw new Error("BUSINESS_EMAIL not configured");

    const dateStamp = startedAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const attachments = tabs.map((t) => ({
      filename: `${dateStamp}-${t.tabName.replace(/[^a-zA-Z0-9._-]/g, "_")}.csv`,
      mimeType: "text/csv",
      content: t.csv,
    }));

    const summaryLines = tabs
      .map((t) => `  ${t.tabName}: ${t.rowCount} row${t.rowCount === 1 ? "" : "s"}`)
      .join("\n");
    const bodyText = [
      `Daily Forge Sheet backup — ${dateStamp}`,
      "",
      `Total rows across ${tabs.length} tab${tabs.length === 1 ? "" : "s"}: ${totalRows}`,
      "",
      "Per-tab row counts:",
      summaryLines,
      "",
      "Each tab is attached as its own CSV file. Files are RFC 4180 encoded.",
      "",
      "Drop these into a backup folder somewhere safe (Google Drive, Dropbox, external drive).",
      "If you ever need to restore: paste the CSV contents back into the matching tab in the master sheet.",
      "",
      "— Forge automation",
    ].join("\n");

    await sendEmailWithAttachments({
      to: businessEmail,
      subject: `Forge Sheet Backup — ${dateStamp}`,
      bodyText,
      attachments,
    });

    logger.info(
      { totalRows, tabCount: tabs.length, durationMs: Date.now() - startedAt.getTime() },
      "backup-sheet: daily backup emailed",
    );

    return NextResponse.json({
      ok: true,
      tabCount: tabs.length,
      totalRows,
      sentTo: businessEmail,
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "cron-backup-sheet" } });
    logger.error({ err }, "backup-sheet: failed");
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
