import { NextResponse, type NextRequest } from "next/server";
import {
  appendSheetRow,
  createCalendarEvent,
  sendNotificationEmail,
  type ContactSubmission,
} from "@/lib/google";
import { checkServiceArea } from "@/lib/geocoding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawPayload = Partial<Record<keyof ContactSubmission, unknown>>;

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function checkRateLimit(ip: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const existing = rateLimits.get(ip);
  if (!existing || existing.resetAt < now) {
    rateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true };
  }
  if (existing.count >= RATE_LIMIT_MAX) {
    return {
      ok: false,
      retryAfterSec: Math.ceil((existing.resetAt - now) / 1000),
    };
  }
  existing.count += 1;
  return { ok: true };
}

function cleanString(value: unknown, max = 2000): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function validate(raw: RawPayload): {
  data?: ContactSubmission;
  error?: string;
} {
  const name = cleanString(raw.name, 120);
  const phone = cleanString(raw.phone, 40);
  const email = cleanString(raw.email, 160);
  const address = cleanString(raw.address, 240);
  const serviceType = cleanString(raw.serviceType, 80);
  const preferredDate = cleanString(raw.preferredDate, 40);
  const description = cleanString(raw.description, 4000);
  const referralSource = cleanString(raw.referralSource, 80) || "Not specified";

  if (!name) return { error: "Name is required." };
  if (!phone || phone.replace(/\D/g, "").length < 10)
    return { error: "A valid phone number is required." };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { error: "A valid email is required." };
  if (!address) return { error: "Address or city is required." };
  if (!serviceType) return { error: "Service type is required." };
  if (!preferredDate) return { error: "Preferred date is required." };
  if (!description) return { error: "A description of the work is required." };

  return {
    data: {
      name,
      phone,
      email,
      address,
      serviceType,
      preferredDate,
      description,
      referralSource,
      submittedAt: new Date().toISOString(),
    },
  };
}

function isDevMode(): boolean {
  return process.env.NEXT_PUBLIC_DEV_MODE === "true";
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json(
      {
        error:
          "Too many requests. Please wait a bit before submitting again, or call us directly.",
      },
      {
        status: 429,
        headers: rate.retryAfterSec
          ? { "Retry-After": String(rate.retryAfterSec) }
          : undefined,
      },
    );
  }

  let raw: RawPayload;
  try {
    raw = (await request.json()) as RawPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid request format." },
      { status: 400 },
    );
  }

  const { data, error } = validate(raw);
  if (!data) {
    return NextResponse.json({ error: error ?? "Invalid input." }, { status: 400 });
  }

  const serviceArea = await checkServiceArea(data.address);
  if (!serviceArea.inArea) {
    return NextResponse.json({
      ok: false,
      outOfArea: true,
      distanceMiles: Math.round(serviceArea.distanceMiles * 10) / 10,
      radiusMiles: serviceArea.radiusMiles,
    });
  }

  if (isDevMode()) {
    console.log("\n[contact-form] DEV_MODE — submission logged, no APIs called:");
    console.log(JSON.stringify(data, null, 2));
    return NextResponse.json({ ok: true, mode: "dev" });
  }

  try {
    await sendNotificationEmail(data);
  } catch (err) {
    console.error("[contact-form] email notification failed:", err);
    return NextResponse.json(
      {
        error:
          "We couldn't send your request right now. Please call (828) 551-9690 or try again in a few minutes.",
      },
      { status: 502 },
    );
  }

  const [calendarResult, sheetResult] = await Promise.allSettled([
    createCalendarEvent(data),
    appendSheetRow(data),
  ]);

  if (calendarResult.status === "rejected") {
    console.error(
      "[contact-form] calendar event failed:",
      calendarResult.reason,
    );
  }
  if (sheetResult.status === "rejected") {
    console.error("[contact-form] sheet append failed:", sheetResult.reason);
  }

  return NextResponse.json({ ok: true });
}
