import { createHmac, timingSafeEqual } from "node:crypto";

// Signed, unguessable cancel links for customers (no login). Mirrors the
// unsubscribe-token pattern and reuses UNSUBSCRIBE_HMAC_SECRET — a distinct
// version namespace ("cancel-v1") means an unsubscribe token can't be replayed
// as a cancel token (different signed payload → different signature).
const TOKEN_VERSION = "cancel-v1";
const TOKEN_TTL_DAYS = 60; // appointments are ≤30 days out; 60 covers the lifecycle

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_HMAC_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "UNSUBSCRIBE_HMAC_SECRET must be set (32+ chars) to sign cancel links",
    );
  }
  return secret;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function sign(payload: string): string {
  return base64Url(createHmac("sha256", getSecret()).update(payload).digest());
}

export function signCancelToken(appointmentId: string): string {
  const issued = Date.now().toString();
  const idB64 = base64Url(Buffer.from(appointmentId, "utf-8"));
  const issuedB64 = base64Url(Buffer.from(issued, "utf-8"));
  const payload = `${TOKEN_VERSION}.${idB64}.${issuedB64}`;
  return `${payload}.${sign(payload)}`;
}

export interface VerifyCancelResult {
  ok: boolean;
  appointmentId?: string;
  reason?: "malformed" | "bad-signature" | "expired" | "wrong-version";
}

export function verifyCancelToken(token: string): VerifyCancelResult {
  if (!token) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [version, idB64, issuedB64, sigB64] = parts;
  if (version !== TOKEN_VERSION) return { ok: false, reason: "wrong-version" };

  const payload = `${version}.${idB64}.${issuedB64}`;
  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = fromBase64Url(sigB64);
    expected = fromBase64Url(sign(payload));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  let appointmentId: string;
  let issuedAt: number;
  try {
    appointmentId = fromBase64Url(idB64).toString("utf-8");
    issuedAt = Number(fromBase64Url(issuedB64).toString("utf-8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: "malformed" };
  if (Date.now() - issuedAt > TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, appointmentId };
}

export function buildCancelUrl(appointmentId: string): string {
  const base =
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || "https://forgehandyman.com";
  const safeBase = /vercel\.app$/i.test(base) ? "https://forgehandyman.com" : base;
  return `${safeBase}/booking/cancel?token=${encodeURIComponent(signCancelToken(appointmentId))}`;
}
