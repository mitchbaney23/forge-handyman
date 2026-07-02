import { getBusinessEmail, escapeHtml, sendGmail } from "@/lib/email/gmail";
import type { DigestSections } from "@/lib/automation/lifecycle";
import type { DriftFinding } from "@/lib/automation/lifecycle";
import type { JobRow } from "@/lib/data";

// Daily stalled-deal digest to the owner, sent by the lifecycle cron only when
// there's something to act on. Internal email — plain sections with job links,
// no brand shell, no unsubscribe.

function siteBase(): string {
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://forgehandyman.com";
  return /vercel\.app$/i.test(base) ? "https://forgehandyman.com" : base;
}

function jobUrl(jobId: string): string {
  return `${siteBase()}/admin/jobs/${encodeURIComponent(jobId)}`;
}

function daysAgoLabel(iso: string, now: Date): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const days = Math.floor((now.getTime() - t) / (24 * 60 * 60 * 1000));
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

function rowLine(row: JobRow, extra: string): { html: string; text: string } {
  const who = row.name || row.email || "(no name)";
  const what = row.service_type || "job";
  const url = jobUrl(row.job_id || "");
  return {
    html: `<li style="margin:0 0 8px;font-size:14px;line-height:1.5;"><a href="${url}" style="color:#1B2A4A;font-weight:600;">${escapeHtml(who)}</a> — ${escapeHtml(what)}${extra ? ` <span style="color:#6b7280;">(${escapeHtml(extra)})</span>` : ""}</li>`,
    text: `- ${who} — ${what}${extra ? ` (${extra})` : ""}\n  ${url}`,
  };
}

function section(
  title: string,
  lines: { html: string; text: string }[],
): { html: string; text: string } {
  if (lines.length === 0) return { html: "", text: "" };
  return {
    html: `<h3 style="margin:20px 0 8px;font-size:15px;color:#1B2A4A;">${escapeHtml(title)}</h3><ul style="margin:0;padding:0 0 0 18px;">${lines.map((l) => l.html).join("")}</ul>`,
    text: `\n${title}\n${lines.map((l) => l.text).join("\n")}\n`,
  };
}

export async function sendOwnerDigestEmail(args: {
  sections: DigestSections;
  drift: DriftFinding[];
  now: Date;
}): Promise<void> {
  const { sections, drift, now } = args;

  const parts = [
    section(
      `Leads waiting on a first touch (${sections.staleLeads.length})`,
      sections.staleLeads.map((row) =>
        rowLine(row, `came in ${daysAgoLabel(row.submitted_at, now)}`),
      ),
    ),
    section(
      `Quotes sent 3+ days ago, unpaid (${sections.unpaidQuotes.length})`,
      sections.unpaidQuotes.map((q) =>
        rowLine(q.row, `sent ${daysAgoLabel(q.sentAt, now)}`),
      ),
    ),
    section(
      `Quote links expiring within 48h (${sections.expiringQuotes.length})`,
      sections.expiringQuotes.map((q) => {
        const t = new Date(q.expiresAt).getTime();
        const expired = Number.isFinite(t) && t < now.getTime();
        return rowLine(q.row, expired ? "ALREADY EXPIRED — re-send a fresh quote" : "customer was nudged automatically");
      }),
    ),
    section(
      `Payment failed (${sections.paymentFailed.length})`,
      sections.paymentFailed.map((row) => rowLine(row, "needs a new card or retry")),
    ),
    section(
      `⚠ Stripe/database drift (${drift.length})`,
      drift.map((d) => ({
        html: `<li style="margin:0 0 8px;font-size:14px;line-height:1.5;"><a href="${jobUrl(d.jobId)}" style="color:#B91C1C;font-weight:600;">${escapeHtml(d.jobId)}</a> — ${escapeHtml(d.detail)}</li>`,
        text: `- ${d.jobId} — ${d.detail}\n  ${jobUrl(d.jobId)}`,
      })),
    ),
  ].filter((p) => p.html);

  const count = parts.length;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#ffffff;font-family:Inter,Arial,sans-serif;color:#1f2937;">
    <h2 style="margin:0 0 4px;font-size:18px;color:#1B2A4A;">Forge daily digest</h2>
    <p style="margin:0 0 12px;font-size:13px;color:#6b7280;">Deals that need a push, straight from the CRM. Links open the job page.</p>
    ${parts.map((p) => p.html).join("")}
  </body></html>`;
  const text = [`Forge daily digest`, ...parts.map((p) => p.text)].join("\n");

  await sendGmail({
    to: getBusinessEmail(),
    subject: `Forge digest: ${count} thing${count === 1 ? "" : "s"} need a push`,
    html,
    text,
  });
}
