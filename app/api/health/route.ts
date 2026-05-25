import { google } from "googleapis";
import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";
import { getStripe } from "@/lib/stripe/client";
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
  const required = [
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_PRIVATE_KEY",
    "GOOGLE_SHEET_ID",
    "BUSINESS_EMAIL",
    "NEXTAUTH_SECRET",
    "ADMIN_ALLOWLIST",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
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
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
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

export async function GET(): Promise<NextResponse> {
  const startedAt = new Date().toISOString();
  const checks = await Promise.all([
    checkEnvVars(),
    checkSheets(),
    checkStripe(),
    checkUpstash(),
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
