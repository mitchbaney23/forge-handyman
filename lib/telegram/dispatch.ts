import {
  SERVICE_LABEL_BY_CODE,
  type ServiceCategoryCode,
} from "@/lib/constants";
import { logger, maskPhone } from "@/lib/security/logger";
import type { ContactRow } from "@/lib/sheet/repo";
import { sendMessage, type InlineButton } from "@/lib/telegram/client";

// Telegram callback_data has a 64-byte limit. Short action prefixes + the
// 36-char UUID jobId stay comfortably under it.
export const DISPATCH_ACTIONS = {
  approve: "a",
  decline: "d",
  sub: "s",
} as const;

export function buildCallbackData(action: "a" | "d" | "s", jobId: string): string {
  return `${action}:${jobId}`;
}

export function parseCallbackData(
  data: string,
): { action: "a" | "d" | "s"; jobId: string } | null {
  const [action, jobId] = data.split(":");
  if ((action === "a" || action === "d" || action === "s") && jobId) {
    return { action, jobId };
  }
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mapsLink(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function serviceLabel(row: ContactRow): string {
  // Cart bookings set a descriptive service_type (a package name like "The
  // Honey-Do" or "Menu order: N items") that isn't one of the category codes —
  // show it as-is so David sees the package/order at a glance.
  const st = (row.service_type || "").trim();
  if (st && !(st in SERVICE_LABEL_BY_CODE)) return st;
  const codes = (row.service_categories || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ServiceCategoryCode[];
  if (codes.length === 1) return SERVICE_LABEL_BY_CODE[codes[0]] ?? row.service_type;
  if (codes.length >= 2) return "Multiple things (a punch list)";
  return SERVICE_LABEL_BY_CODE[(row.service_type || "other") as ServiceCategoryCode] ?? row.service_type;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const CONTACT_TIME_LABEL: Record<string, string> = {
  any: "any time",
  morning: "mornings",
  afternoon: "afternoons",
  evening: "evenings",
};
const CONTACT_METHOD_LABEL: Record<string, string> = {
  any: "call or text",
  phone: "prefers a call",
  text: "prefers a text",
  email: "prefers email",
};

export function buildDispatchMessage(row: ContactRow): string {
  const photoCount = (row.photo_urls || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean).length;
  const returning =
    row.is_returning_customer === "true" || Number(row.prior_job_count || "0") > 0;
  const contactPref = [
    CONTACT_METHOD_LABEL[row.best_contact_method || "any"],
    CONTACT_TIME_LABEL[row.best_contact_time || "any"],
  ]
    .filter(Boolean)
    .join(", ");

  const lines = [
    `🔨 <b>New job — ${escapeHtml(row.name || "(no name)")}</b>`,
    "",
    `📍 <a href="${mapsLink(row.address || "")}">${escapeHtml(row.address || "—")}</a>`,
    `🛠 ${escapeHtml(serviceLabel(row))}`,
    `📅 Preferred: ${escapeHtml(formatDate(row.preferred_date || ""))}`,
    row.phone ? `📞 ${escapeHtml(row.phone)} · ${escapeHtml(contactPref)}` : "",
    photoCount > 0 ? `📷 ${photoCount} photo${photoCount === 1 ? "" : "s"}` : "",
    returning
      ? `↩️ <i>Returning customer · ${escapeHtml(String(row.prior_job_count || "1"))} prior</i>`
      : "",
    "",
    `<b>Job:</b> ${escapeHtml((row.description || "").slice(0, 600))}`,
  ].filter((l) => l !== "");

  return lines.join("\n");
}

export function buildDispatchKeyboard(jobId: string): InlineButton[][] {
  return [
    [
      { text: "✅ Approve", callback_data: buildCallbackData("a", jobId) },
      { text: "❌ Decline", callback_data: buildCallbackData("d", jobId) },
      { text: "🔁 Sub out", callback_data: buildCallbackData("s", jobId) },
    ],
  ];
}

export interface DispatchResult {
  ok: boolean;
  messageId?: number;
  reason?: string;
}

/**
 * Sends a job card to David's Telegram with Approve/Decline/Sub-out buttons.
 * Returns the sent message_id (so the caller can record it for later edits).
 * Best-effort: returns { ok:false } on any miss rather than throwing.
 */
export async function dispatchJobToDavid(row: ContactRow): Promise<DispatchResult> {
  const davidChatId = process.env.TELEGRAM_DAVID_CHAT_ID;
  if (!davidChatId) {
    logger.warn("telegram-dispatch: TELEGRAM_DAVID_CHAT_ID not set — skipping");
    return { ok: false, reason: "no-chat-id" };
  }
  if (!row.job_id) {
    return { ok: false, reason: "no-job-id" };
  }
  const sent = await sendMessage(
    davidChatId,
    buildDispatchMessage(row),
    buildDispatchKeyboard(row.job_id),
  );
  if (!sent) {
    logger.warn({ jobId: row.job_id }, "telegram-dispatch: send failed");
    return { ok: false, reason: "send-failed" };
  }
  logger.info(
    { jobId: row.job_id, maskedPhone: maskPhone(row.phone), messageId: sent.message_id },
    "telegram-dispatch: job card sent to David",
  );
  return { ok: true, messageId: sent.message_id };
}

/**
 * Sends Mitch an informational copy of a new lead — same job card, but with
 * NO action buttons (David owns the Approve/Decline/Sub-out decision). Gives
 * the owner real-time visibility on Telegram alongside the existing email.
 * Best-effort.
 */
export async function notifyMitchNewLead(row: ContactRow): Promise<DispatchResult> {
  const mitchChatId = process.env.TELEGRAM_MITCH_CHAT_ID;
  if (!mitchChatId) {
    logger.warn("telegram-dispatch: TELEGRAM_MITCH_CHAT_ID not set — skipping Mitch FYI");
    return { ok: false, reason: "no-chat-id" };
  }
  if (!row.job_id) {
    return { ok: false, reason: "no-job-id" };
  }
  const text = `📋 <b>New lead in</b> — sent to David for approval.\n\n${buildDispatchMessage(row)}`;
  const sent = await sendMessage(mitchChatId, text); // no keyboard — FYI only
  if (!sent) {
    logger.warn({ jobId: row.job_id }, "telegram-dispatch: Mitch FYI send failed");
    return { ok: false, reason: "send-failed" };
  }
  logger.info(
    { jobId: row.job_id, messageId: sent.message_id },
    "telegram-dispatch: new-lead FYI sent to Mitch",
  );
  return { ok: true, messageId: sent.message_id };
}
