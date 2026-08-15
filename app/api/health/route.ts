import { google } from "googleapis";
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getStripe } from "@/lib/stripe/client";
import { getBackend, type DataBackend } from "@/lib/data/backend";
import { getSupabaseClient } from "@/lib/data/pg/client";
import { getAuth } from "@/lib/google";
import { getNotificationRecipients } from "@/lib/email/recipients";
import { logger } from "@/lib/security/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cache for 30 seconds to prevent abuse — fresh enough to catch outages,
// not so chatty that we hammer downstream APIs on every UptimeRobot ping.
export const revalidate = 30;

type CheckStatus = "ok" | "degraded" | "fail" | "skipped";

interface HealthCheck {
  name: string;
  status: CheckStatus;
  latencyMs: number;
  detail?: string;
}

const TIMEOUT_MS = 5_000;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function checkEnvVars(): Promise<HealthCheck> {
  const started = Date.now();

  // getBackend() throws on a garbage DATA_BACKEND value. Surface that as an
  // env-vars failure rather than letting it crash the route — a typo in the
  // cutover flag must show up as a red health check, not a 500.
  let backend: DataBackend;
  try {
    backend = getBackend();
  } catch (err) {
    return {
      name: "env-vars",
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const required = [
    // Google service-account creds drive Gmail + Calendar regardless of the
    // data backend, so they stay unconditional.
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "BUSINESS_EMAIL",
    "NEXTAUTH_SECRET",
    "ADMIN_ALLOWLIST",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    // Backend-specific: only the active datastore's vars are required.
    ...(backend === "sheet" ? ["GOOGLE_SHEET_ID"] : []),
    ...(backend === "postgres"
      ? ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
      : []),
  ];
  const missing = required.filter((name) => !process.env[name]);
  return {
    name: "env-vars",
    status: missing.length === 0 ? "ok" : "fail",
    latencyMs: Date.now() - started,
    detail:
      missing.length > 0
        ? `Missing: ${missing.join(", ")}`
        : `${required.length} required vars present`,
  };
}

async function checkSheets(): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const businessEmail = process.env.BUSINESS_EMAIL;
    if (!clientEmail || !privateKey || !spreadsheetId || !businessEmail) {
      return {
        name: "google-sheets",
        status: "skipped",
        latencyMs: Date.now() - started,
        detail: "Required env vars missing",
      };
    }
    // Use the same scope the rest of the app authorized in Workspace DWD
    // (`spreadsheets`), not the narrower `spreadsheets.readonly` — Workspace
    // DWD requires exact-match scope; broader doesn't imply narrower.
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      subject: businessEmail,
    });
    const sheets = google.sheets({ version: "v4", auth });
    // Cheap call: read sheet metadata only, no row data.
    await withTimeout(
      sheets.spreadsheets.get({ spreadsheetId, fields: "spreadsheetId" }),
      TIMEOUT_MS,
    );
    return {
      name: "google-sheets",
      status: "ok",
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name: "google-sheets",
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkPostgres(): Promise<HealthCheck> {
  const started = Date.now();
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return {
        name: "postgres",
        status: "skipped",
        latencyMs: Date.now() - started,
        detail: "Supabase env vars missing",
      };
    }
    const supabase = getSupabaseClient();
    // Cheap call: head count on jobs — no row data transferred.
    await withTimeout(
      Promise.resolve(
        supabase.from("jobs").select("*", { count: "exact", head: true }),
      ).then(({ error }) => {
        if (error) throw new Error(error.message);
      }),
      TIMEOUT_MS,
    );
    return {
      name: "postgres",
      status: "ok",
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name: "postgres",
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkStripe(): Promise<HealthCheck> {
  const started = Date.now();
  try {
    if (!process.env.STRIPE_SECRET_KEY_TEST && !process.env.STRIPE_SECRET_KEY_LIVE) {
      return {
        name: "stripe",
        status: "skipped",
        latencyMs: Date.now() - started,
        detail: "No Stripe key configured",
      };
    }
    const stripe = getStripe();
    // Cheap call: retrieve the Balance object, which always exists for the account.
    await withTimeout(stripe.balance.retrieve(), TIMEOUT_MS);
    return {
      name: "stripe",
      status: "ok",
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name: "stripe",
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// Calendar connectivity — scheduling reads free/busy + writes bookings here, so
// a calendar outage breaks self-scheduling even though the data backend is fine.
async function checkGoogleCalendar(): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const calendarId = process.env.GOOGLE_CALENDAR_ID;
    if (
      !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      !process.env.GOOGLE_PRIVATE_KEY ||
      !calendarId
    ) {
      return {
        name: "google-calendar",
        status: "skipped",
        latencyMs: Date.now() - started,
        detail: "Calendar env vars missing",
      };
    }
    const calendar = google.calendar({ version: "v3", auth: getAuth() });
    // Cheap call: read calendar metadata only, no event data.
    await withTimeout(calendar.calendars.get({ calendarId }), TIMEOUT_MS);
    return { name: "google-calendar", status: "ok", latencyMs: Date.now() - started };
  } catch (err) {
    return {
      name: "google-calendar",
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// Telegram dispatch is the channel David actually works off, and every call
// site is best-effort — a dead bot token or a revoked chat fails silently in
// the logs and looks identical to "no leads came in". Probe getMe so an outage
// is visible here instead of being discovered by a missed job.
async function checkTelegram(): Promise<HealthCheck> {
  const started = Date.now();
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (process.env.DISPATCH_DISABLED === "true") {
    return {
      name: "telegram",
      status: "skipped",
      latencyMs: 0,
      detail: "DISPATCH_DISABLED=true",
    };
  }
  if (!token) {
    return {
      name: "telegram",
      status: "skipped",
      latencyMs: 0,
      detail: "TELEGRAM_BOT_TOKEN not set",
    };
  }
  try {
    const res = await withTimeout(
      fetch(`https://api.telegram.org/bot${token}/getMe`),
      TIMEOUT_MS,
    );
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: { username?: string };
      description?: string;
    };
    if (!res.ok || !data.ok) {
      return {
        name: "telegram",
        status: "fail",
        latencyMs: Date.now() - started,
        detail: data.description ?? `HTTP ${res.status}`,
      };
    }
    // A live bot with no chat IDs still can't reach anyone — call that degraded,
    // not ok, so a half-configured dispatch doesn't read as healthy.
    const missingChats = ["TELEGRAM_DAVID_CHAT_ID", "TELEGRAM_MITCH_CHAT_ID"].filter(
      (name) => !process.env[name],
    );
    return {
      name: "telegram",
      status: missingChats.length > 0 ? "degraded" : "ok",
      latencyMs: Date.now() - started,
      detail:
        missingChats.length > 0
          ? `@${data.result?.username ?? "?"} alive, but missing: ${missingChats.join(", ")}`
          : `@${data.result?.username ?? "?"}`,
    };
  } catch (err) {
    return {
      name: "telegram",
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkUpstash(): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      return {
        name: "upstash-redis",
        status: "skipped",
        latencyMs: Date.now() - started,
        detail: "Upstash env vars missing",
      };
    }
    const redis = new Redis({ url, token });
    await withTimeout(redis.ping(), TIMEOUT_MS);
    return {
      name: "upstash-redis",
      status: "ok",
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      name: "upstash-redis",
      status: "fail",
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// Surface the resolved lead-notification recipients. Not a connectivity probe —
// it answers "where do website submissions actually go?" without a deploy or a
// test submission, which is exactly the question that was previously unanswerable.
function checkLeadRouting(): HealthCheck {
  try {
    const recipients = getNotificationRecipients();
    return {
      name: "lead-routing",
      status: "ok",
      latencyMs: 0,
      detail: recipients.join(", "),
    };
  } catch (err) {
    return {
      name: "lead-routing",
      status: "fail",
      latencyMs: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// Connectivity check for the INACTIVE backend: never run it (rollback must be
// able to go green while the other datastore is down, and staged-but-unused
// vars must not page production). Report it as skipped so the JSON still lists
// every check.
function inactiveBackendCheck(name: "google-sheets" | "postgres"): HealthCheck {
  return {
    name,
    status: "skipped",
    latencyMs: 0,
    detail: "inactive backend",
  };
}

export async function GET(): Promise<NextResponse> {
  const startedAt = new Date().toISOString();

  // Resolve the active backend so we only run (and only let fail) that
  // datastore's connectivity check. A garbage DATA_BACKEND throws — checkEnvVars
  // already turns that into a red check; here we fall back to running NEITHER
  // backend's connectivity check (both reported skipped) so the route still
  // responds with a clear env-vars failure instead of 500ing.
  let backend: DataBackend | null = null;
  try {
    backend = getBackend();
  } catch {
    backend = null;
  }

  const sheetsCheck =
    backend === "sheet" ? checkSheets() : Promise.resolve(inactiveBackendCheck("google-sheets"));
  const postgresCheck =
    backend === "postgres" ? checkPostgres() : Promise.resolve(inactiveBackendCheck("postgres"));

  const checks = await Promise.all([
    checkEnvVars(),
    sheetsCheck,
    postgresCheck,
    checkGoogleCalendar(),
    checkStripe(),
    checkUpstash(),
    checkTelegram(),
    Promise.resolve(checkLeadRouting()),
  ]);

  const anyFailed = checks.some((c) => c.status === "fail");
  const allOkOrSkipped = checks.every(
    (c) => c.status === "ok" || c.status === "skipped",
  );
  const overall: CheckStatus = anyFailed
    ? "fail"
    : allOkOrSkipped
      ? "ok"
      : "degraded";

  const body = {
    status: overall,
    timestamp: startedAt,
    backend,
    checks,
  };

  if (anyFailed) {
    logger.warn({ checks }, "health: at least one check failed");
  }

  return NextResponse.json(body, {
    status: overall === "fail" ? 503 : 200,
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=10",
    },
  });
}
