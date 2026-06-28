import { getServerSession } from "next-auth";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { checkLimit } from "@/lib/security/rate-limit";

// Shared admin gate for server actions. Lifted verbatim from the inline
// requireAdmin/rateLimitAdmin that used to live in app/admin/jobs/[id]/actions.ts
// so every admin mutation surface (jobs, pipeline, customers) shares ONE
// boundary. middleware.ts already gates the /admin route prefix; these are the
// defense-in-depth checks inside each action (server actions are independently
// invokable, so the guard belongs here too, not only at the route edge).

export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export interface AdminAuth {
  email: string;
}

export async function requireAdmin(): Promise<AdminAuth | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email || !isAllowlistedEmail(email)) return null;
  return { email };
}

export async function rateLimitAdmin(email: string): Promise<boolean> {
  const result = await checkLimit("admin-action", email);
  return result.success;
}
