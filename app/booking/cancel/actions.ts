"use server";

import { verifyCancelToken } from "@/lib/scheduling/cancel-token";
import { performCancellation } from "@/lib/scheduling/cancel";
import { checkLimit } from "@/lib/security/rate-limit";
import { BUSINESS } from "@/lib/constants";

export type CancelByTokenResult = { ok: true } | { ok: false; error: string };

// Public, token-authenticated cancellation (no login). The signed token is the
// authorization; we still rate-limit per appointment to blunt abuse.
export async function cancelByToken(token: string): Promise<CancelByTokenResult> {
  const v = verifyCancelToken(token);
  if (!v.ok || !v.appointmentId) {
    return { ok: false, error: "This cancellation link is invalid or has expired." };
  }
  const rl = await checkLimit("scheduling-availability", `cancel:${v.appointmentId}`);
  if (!rl.success) {
    return { ok: false, error: "Too many attempts — please try again in a few minutes." };
  }
  const result = await performCancellation(v.appointmentId, "customer");
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "already_cancelled"
          ? "This appointment is already cancelled."
          : `We couldn't cancel this appointment — please call us at ${BUSINESS.phone}.`,
    };
  }
  return { ok: true };
}
