import { logger } from "@/lib/security/logger";

const API_BASE = "https://api.telegram.org";

function getBotToken(): string | null {
  return process.env.TELEGRAM_BOT_TOKEN ?? null;
}

export function isTelegramConfigured(): boolean {
  return Boolean(getBotToken());
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

type InlineKeyboard = InlineButton[][];

async function callApi<T = unknown>(
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const token = getBotToken();
  if (!token) {
    logger.warn({ method }, "telegram: TELEGRAM_BOT_TOKEN not set — skipping call");
    return { ok: false, description: "not-configured" };
  }
  try {
    const res = await fetch(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      description?: string;
    };
    if (!res.ok || !data.ok) {
      logger.warn(
        { method, status: res.status, description: data.description },
        "telegram: API call failed",
      );
      return { ok: false, description: data.description };
    }
    return { ok: true, result: data.result };
  } catch (err) {
    logger.error({ err, method }, "telegram: API request threw");
    return { ok: false, description: "request-error" };
  }
}

export interface SentMessage {
  message_id: number;
  chat: { id: number };
}

export async function sendMessage(
  chatId: string | number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<SentMessage | null> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
  const res = await callApi<SentMessage>("sendMessage", body);
  return res.ok && res.result ? res.result : null;
}

export async function editMessageText(
  chatId: string | number,
  messageId: number | string,
  text: string,
): Promise<boolean> {
  const res = await callApi("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  return res.ok;
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<boolean> {
  const res = await callApi("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  });
  return res.ok;
}
