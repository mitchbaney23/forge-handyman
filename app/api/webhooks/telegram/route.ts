import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { logger } from "@/lib/security/logger";
import {
  checkLimit,
  extractIp,
} from "@/lib/security/rate-limit";
import { appendAuditRow, findRowByJobId, updateRowByJobId } from "@/lib/data";
import {
  answerCallbackQuery,
  editMessageText,
  sendMessage,
} from "@/lib/telegram/client";
import {
  buildDispatchMessage,
  parseCallbackData,
} from "@/lib/telegram/dispatch";
import { checkAndMarkProcessed } from "@/lib/webhooks/idempotency";
import { verifySharedSecret } from "@/lib/webhooks/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal shape of the Telegram Update payloads we handle.
interface TelegramUpdate {
  update_id?: number;
  message?: {
    chat?: { id?: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id?: number; chat?: { id?: number } };
    from?: { id?: number };
  };
}

const DECISION_LABEL = {
  a: { decision: "Approved", status: "Approved", confirm: "✅ You're on this one. We'll confirm the time with the customer." },
  d: { decision: "Declined", status: "Declined", confirm: "❌ Marked as declined. Mitch will reassign." },
  s: { decision: "Needs Sub", status: "Needs Sub", confirm: "🔁 Flagged to sub out. Mitch will line someone up." },
} as const;

function ok(): NextResponse {
  return NextResponse.json({ ok: true });
}

async function notifyMitch(text: string): Promise<void> {
  const mitchChatId = process.env.TELEGRAM_MITCH_CHAT_ID;
  if (!mitchChatId) return;
  await sendMessage(mitchChatId, text);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Verify the secret token Telegram echoes back (route is public).
  const provided = request.headers.get("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!expected || !verifySharedSecret(provided, expected)) {
    logger.warn("telegram-webhook: bad or missing secret token");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Rate limit.
  const ip = extractIp(request);
  const limit = await checkLimit("telegram-webhook", ip);
  if (!limit.success) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  // 3. Idempotency on update_id (Telegram retries until it gets a 200).
  if (typeof update.update_id === "number") {
    const { isFirst } = await checkAndMarkProcessed("telegram", String(update.update_id));
    if (!isFirst) {
      logger.info({ updateId: update.update_id }, "telegram-webhook: duplicate update ignored");
      return ok();
    }
  }

  try {
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleMessage(update.message);
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "telegram-webhook" } });
    logger.error({ err }, "telegram-webhook: handler threw");
    // Still 200 so Telegram doesn't hammer retries; we've logged it.
  }

  return ok();
}

async function handleCallback(
  cb: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const davidChatId = process.env.TELEGRAM_DAVID_CHAT_ID;
  const fromChatId = cb.message?.chat?.id ?? cb.from?.id;

  // Only David may decide. Anyone else gets a polite toast.
  if (davidChatId && String(fromChatId) !== String(davidChatId)) {
    await answerCallbackQuery(cb.id, "This dispatch is for David.");
    return;
  }

  const parsed = cb.data ? parseCallbackData(cb.data) : null;
  if (!parsed) {
    await answerCallbackQuery(cb.id, "Couldn't read that action.");
    return;
  }

  const found = await findRowByJobId(parsed.jobId);
  if (!found) {
    await answerCallbackQuery(cb.id, "That job wasn't found.");
    return;
  }

  const label = DECISION_LABEL[parsed.action];
  const decidedAt = new Date().toISOString();

  await updateRowByJobId(parsed.jobId, {
    dispatch_status: label.status,
    dispatch_decision: label.decision,
    dispatch_decided_at: decidedAt,
  });

  // Edit David's message: strip the buttons, append his decision.
  const chatId = cb.message?.chat?.id;
  const messageId = cb.message?.message_id;
  if (chatId && messageId) {
    const updatedRow = { ...found.row, dispatch_status: label.status };
    await editMessageText(
      chatId,
      messageId,
      `${buildDispatchMessage(updatedRow)}\n\n— <b>${label.decision}</b> ✓`,
    );
  }

  await answerCallbackQuery(cb.id, label.confirm);

  await notifyMitch(
    `David <b>${label.decision.toLowerCase()}</b> the job for <b>${escapeName(found.row.name)}</b> (${escapeName(found.row.service_type)}).` +
      (parsed.action === "d" || parsed.action === "s"
        ? "\n\n⚠️ Needs your attention."
        : ""),
  );

  await appendAuditRow({
    actor: "telegram:david",
    action: `dispatch.${label.decision.toLowerCase().replace(/\s+/g, "_")}`,
    target: parsed.jobId,
    after: JSON.stringify({ decision: label.decision, decidedAt }),
  });

  logger.info(
    { jobId: parsed.jobId, decision: label.decision },
    "telegram-webhook: David decision recorded",
  );
}

async function handleMessage(
  msg: NonNullable<TelegramUpdate["message"]>,
): Promise<void> {
  const chatId = msg.chat?.id;
  if (!chatId) return;
  const davidChatId = process.env.TELEGRAM_DAVID_CHAT_ID;
  const mitchChatId = process.env.TELEGRAM_MITCH_CHAT_ID;
  const isKnown =
    String(chatId) === String(davidChatId) || String(chatId) === String(mitchChatId);

  if (isKnown) {
    // We're not a chatbot — just acknowledge.
    await sendMessage(
      chatId,
      "👋 This is the Forge dispatch bot. You'll get job cards here with Approve / Decline / Sub out buttons.",
    );
    return;
  }

  // Onboarding helper: reply with the chat ID so it can be pasted into Vercel.
  await sendMessage(
    chatId,
    `Your Telegram chat ID is:\n<code>${chatId}</code>\n\nPaste this into Vercel as TELEGRAM_DAVID_CHAT_ID (David) or TELEGRAM_MITCH_CHAT_ID (Mitch).`,
  );
  logger.info({ chatId }, "telegram-webhook: replied with chat id for onboarding");
}

function escapeName(value: string): string {
  return (value || "—").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
