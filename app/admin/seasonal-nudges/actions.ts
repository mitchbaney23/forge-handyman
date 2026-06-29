"use server";

import { google } from "googleapis";
import type { JWT } from "google-auth-library";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { buildUnsubscribeUrl } from "@/lib/automation/unsubscribe";
import { BUSINESS } from "@/lib/constants";
import { logger, maskEmail } from "@/lib/security/logger";
import { checkLimit } from "@/lib/security/rate-limit";
import { appendAuditRow, updateRowByJobId } from "@/lib/data";

const SCOPES = ["https://www.googleapis.com/auth/gmail.send"];

function getBusinessEmail(): string {
  const email = process.env.BUSINESS_EMAIL;
  if (!email) throw new Error("BUSINESS_EMAIL is not configured");
  return email;
}

function getAuth(): JWT {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set",
    );
  }
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: SCOPES,
    subject: getBusinessEmail(),
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function encodeMimeHeader(value: string): string {
  if (!value) return value;
  if (!/[^ -]/.test(value)) return value;
  const b64 = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function encodeRfc2822(message: {
  to: string;
  from: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const boundary = `----=_Boundary_${Date.now()}`;
  const lines = [
    `To: ${message.to}`,
    `From: ${message.from}`,
    `Reply-To: ${message.replyTo}`,
    `Subject: ${encodeMimeHeader(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    message.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    message.html,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  return Buffer.from(lines)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function textToHtml(plainText: string, unsubscribeUrl: string): string {
  const escaped = escapeHtml(plainText)
    .replace(/\n\n/g, "</p><p style=\"margin:0 0 16px;\">")
    .replace(/\n/g, "<br/>");
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f8f9fa;font-family:Inter,Arial,sans-serif;color:#1f2937;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa;padding:24px 0;">
      <tr><td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr><td style="padding:28px;">
            <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#1f2937;">${escaped}</p>
          </td></tr>
          <tr><td style="background:#F3F4F6;padding:16px 28px;font-size:11px;color:#6b7280;text-align:center;line-height:1.5;">
            Forge Handyman Service · Garner, Raleigh, Cary, Clayton, Knightdale, Wendell, Holly Springs &amp; Fuquay-Varina, NC<br/>
            ${escapeHtml(BUSINESS.mailingAddress)}<br/>
            <a href="${unsubscribeUrl}" style="color:#6b7280;text-decoration:underline;">Unsubscribe from follow-ups</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export type NudgeActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email || !isAllowlistedEmail(email)) return null;
  return { email };
}

async function markSeasonalNudgeSent(
  jobIds: string[],
  sentAt: string,
): Promise<void> {
  for (const id of jobIds) {
    await updateRowByJobId(id, { seasonal_nudge_last_sent: sentAt });
  }
}

export async function sendSeasonalNudge(input: {
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  jobIds: string[];
}): Promise<NudgeActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized" };
  if (!(await checkLimit("admin-action", admin.email)).success) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  if (!input.recipientEmail || !input.subject || !input.body) {
    return { ok: false, error: "Missing recipient, subject, or body" };
  }

  try {
    const auth = getAuth();
    const gmail = google.gmail({ version: "v1", auth });
    const businessEmail = getBusinessEmail();
    const unsubscribeUrl = buildUnsubscribeUrl(input.recipientEmail);
    const raw = encodeRfc2822({
      to: input.recipientEmail,
      from: businessEmail,
      replyTo: businessEmail,
      subject: input.subject,
      text: `${input.body}\n\n—\nUnsubscribe: ${unsubscribeUrl}`,
      html: textToHtml(input.body, unsubscribeUrl),
    });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });

    const sentAt = new Date().toISOString();
    await markSeasonalNudgeSent(input.jobIds, sentAt);
    await appendAuditRow({
      actor: admin.email,
      action: "seasonal_nudge.sent",
      target: input.recipientEmail,
      after: JSON.stringify({
        recipientEmail: maskEmail(input.recipientEmail),
        jobIds: input.jobIds,
        subject: input.subject,
      }),
    });
    logger.info(
      {
        actor: admin.email,
        maskedEmail: maskEmail(input.recipientEmail),
        jobIds: input.jobIds.length,
      },
      "seasonal-nudge: sent",
    );
    revalidatePath("/admin/seasonal-nudges");
    return { ok: true, message: "Nudge sent." };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "admin-seasonal-nudge", action: "send" },
    });
    logger.error(
      { err, actor: admin.email, maskedEmail: maskEmail(input.recipientEmail) },
      "seasonal-nudge: send failed",
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Send failed",
    };
  }
}

export async function skipSeasonalNudge(input: {
  recipientEmail: string;
  jobIds: string[];
}): Promise<NudgeActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized" };
  if (!(await checkLimit("admin-action", admin.email)).success) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  try {
    const skippedAt = new Date().toISOString();
    await markSeasonalNudgeSent(input.jobIds, skippedAt);
    await appendAuditRow({
      actor: admin.email,
      action: "seasonal_nudge.skipped",
      target: input.recipientEmail,
    });
    revalidatePath("/admin/seasonal-nudges");
    return { ok: true, message: "Skipped — won't reappear for 180 days." };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "admin-seasonal-nudge", action: "skip" },
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Skip failed",
    };
  }
}
