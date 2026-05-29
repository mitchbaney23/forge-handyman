import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_VERSION = "v1";
const TOKEN_TTL_DAYS = 365; // Generous — unsubscribe links shouldn't expire mid-year

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_HMAC_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "UNSUBSCRIBE_HMAC_SECRET must be set (32+ chars, e.g. `openssl rand -base64 32`)",
    );
  }
  return secret;
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

function sign(payload: string): string {
  return base64Url(createHmac("sha256", getSecret()).update(payload).digest());
}

/**
 * Signs an unsubscribe token for the given email. Format:
 *   <version>.<base64url(email)>.<base64url(issuedAt-ms)>.<base64url(hmac)>
 * The token encodes the email and an issued-at timestamp; verification checks
 * the HMAC signature AND that the token is within TOKEN_TTL_DAYS.
 */
export function signUnsubscribeToken(email: string): string {
  const normalized = email.trim().toLowerCase();
  const issued = Date.now().toString();
  const emailB64 = base64Url(Buffer.from(normalized, "utf-8"));
  const issuedB64 = base64Url(Buffer.from(issued, "utf-8"));
  const payload = `${TOKEN_VERSION}.${emailB64}.${issuedB64}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

export interface VerifyResult {
  ok: boolean;
  email?: string;
  reason?: "malformed" | "bad-signature" | "expired" | "wrong-version";
}

/**
 * Verifies an unsubscribe token and returns the email it was issued for.
 * Constant-time signature comparison; returns the parsed email only when
 * the signature is valid AND the token isn't expired.
 */
export function verifyUnsubscribeToken(token: string): VerifyResult {
  if (!token) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };
  const [version, emailB64, issuedB64, sigB64] = parts;
  if (version !== TOKEN_VERSION) {
    return { ok: false, reason: "wrong-version" };
  }

  const payload = `${version}.${emailB64}.${issuedB64}`;
  const expectedSig = sign(payload);
  let provided: Buffer;
  let expected: Buffer;
  try {
    provided = fromBase64Url(sigB64);
    expected = fromBase64Url(expectedSig);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (provided.length !== expected.length) {
    return { ok: false, reason: "bad-signature" };
  }
  if (!timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad-signature" };
  }

  let email: string;
  let issuedAt: number;
  try {
    email = fromBase64Url(emailB64).toString("utf-8");
    issuedAt = Number(fromBase64Url(issuedB64).toString("utf-8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!Number.isFinite(issuedAt)) {
    return { ok: false, reason: "malformed" };
  }
  const ageMs = Date.now() - issuedAt;
  if (ageMs > TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, email };
}

export function buildUnsubscribeUrl(email: string): string {
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://forgehandyman.com";
  const safeBase = /vercel\.app$/i.test(base)
    ? "https://forgehandyman.com"
    : base;
  const token = signUnsubscribeToken(email);
  return `${safeBase}/unsubscribe?token=${encodeURIComponent(token)}`;
}
