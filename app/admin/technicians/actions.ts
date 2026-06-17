"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { logger } from "@/lib/security/logger";
import { checkLimit } from "@/lib/security/rate-limit";
import { ACTIONS } from "@/lib/data/activity-actions";
import {
  appendAuditRow,
  createTechnician,
  listTechnicians,
  updateTechnician,
} from "@/lib/data";
import { createAvailabilityCalendar } from "@/lib/scheduling/availability";

export type TechResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

async function requireAdmin(): Promise<{ email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;
  if (!email || !isAllowlistedEmail(email)) return null;
  return { email };
}

// The expected technician email domain = the business email's domain, since the
// service account can only impersonate users in that Workspace (domain-wide
// delegation). Falls back to "any valid email" if BUSINESS_EMAIL is unset.
function expectedDomain(): string | null {
  const be = process.env.BUSINESS_EMAIL;
  const at = be?.indexOf("@") ?? -1;
  return at > 0 ? (be as string).slice(at + 1).toLowerCase() : null;
}

// Add a technician AND auto-provision their "Forge Availability" calendar so the
// owner never deals with Calendar IDs or SQL — the whole point of replicable
// onboarding. The calendar provision needs Google creds, so it only runs in an
// environment that has them (prod); a failure leaves the tech created but
// without a calendar, retryable via provisionCalendar.
export async function addTechnician(input: {
  name: string;
  email: string;
  telegramChatId?: string;
}): Promise<TechResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized" };
  if (!(await checkLimit("admin-action", admin.email)).success) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }

  const name = (input.name || "").trim();
  const email = (input.email || "").trim().toLowerCase();
  const telegramChatId = (input.telegramChatId || "").trim();

  if (!name) return { ok: false, error: "Enter the technician's name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const domain = expectedDomain();
  if (domain && !email.endsWith("@" + domain)) {
    return {
      ok: false,
      error: `Use a @${domain} Workspace email — the calendar can only be read for accounts in your domain.`,
    };
  }
  if (telegramChatId && !/^-?\d{1,20}$/.test(telegramChatId)) {
    return { ok: false, error: "Telegram chat ID should be a number (or left blank)." };
  }

  try {
    const existing = await listTechnicians();
    if (existing.some((t) => t.email.toLowerCase() === email)) {
      return { ok: false, error: `${email} is already a technician.` };
    }

    const tech = await createTechnician({ name, email, telegramChatId });
    if (!tech) {
      return { ok: false, error: "Technician store unavailable (postgres only)." };
    }

    await appendAuditRow({
      actor: admin.email,
      action: ACTIONS.TECHNICIAN_ADDED,
      target: tech.id,
      after: JSON.stringify({ name, email }),
    });

    // Auto-provision the availability calendar.
    let calendarMsg = "";
    try {
      const calendarId = await createAvailabilityCalendar(tech.calendarEmail);
      await updateTechnician(tech.id, { availabilityCalendarId: calendarId });
      await appendAuditRow({
        actor: admin.email,
        action: ACTIONS.TECHNICIAN_CALENDAR_PROVISIONED,
        target: tech.id,
        after: calendarId,
      });
      calendarMsg = " Their “Forge Availability” calendar was created — add their open-window events there.";
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: "admin-technicians", action: "provision-calendar" },
      });
      logger.error({ err, techId: tech.id }, "technicians: calendar provision failed");
      calendarMsg =
        " But auto-creating their availability calendar failed — use “Provision calendar” to retry.";
    }

    logger.info({ actor: admin.email, techId: tech.id }, "technicians: added");
    revalidatePath("/admin/technicians");
    return { ok: true, message: `Added ${name}.${calendarMsg}` };
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "admin-technicians", action: "add" } });
    logger.error({ err, actor: admin.email }, "technicians: add failed");
    return { ok: false, error: err instanceof Error ? err.message : "Failed to add technician." };
  }
}

// Retry (or first-time) calendar provisioning for a technician that doesn't have
// one yet — e.g. a seeded row, or a prior provision failure.
export async function provisionCalendar(techId: string): Promise<TechResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized" };
  if (!(await checkLimit("admin-action", admin.email)).success) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }

  try {
    const tech = (await listTechnicians()).find((t) => t.id === techId);
    if (!tech) return { ok: false, error: "Technician not found." };
    if (tech.availabilityCalendarId) {
      return { ok: false, error: "This technician already has an availability calendar." };
    }
    if (!tech.calendarEmail) {
      return { ok: false, error: "Technician has no calendar email set." };
    }
    const calendarId = await createAvailabilityCalendar(tech.calendarEmail);
    await updateTechnician(tech.id, { availabilityCalendarId: calendarId });
    await appendAuditRow({
      actor: admin.email,
      action: ACTIONS.TECHNICIAN_CALENDAR_PROVISIONED,
      target: tech.id,
      after: calendarId,
    });
    logger.info({ actor: admin.email, techId }, "technicians: calendar provisioned");
    revalidatePath("/admin/technicians");
    return { ok: true, message: `Created ${tech.name}'s “Forge Availability” calendar.` };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "admin-technicians", action: "provision-calendar-retry" },
    });
    logger.error({ err, actor: admin.email, techId }, "technicians: provision retry failed");
    return { ok: false, error: err instanceof Error ? err.message : "Provisioning failed." };
  }
}

// Activate / deactivate a technician (a deactivated tech offers no slots).
export async function setTechnicianActive(
  techId: string,
  active: boolean,
): Promise<TechResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: "Not authorized" };
  if (!(await checkLimit("admin-action", admin.email)).success) {
    return { ok: false, error: "Too many actions. Slow down a moment." };
  }
  try {
    await updateTechnician(techId, { active });
    await appendAuditRow({
      actor: admin.email,
      action: ACTIONS.TECHNICIAN_UPDATED,
      target: techId,
      after: JSON.stringify({ active }),
    });
    revalidatePath("/admin/technicians");
    return { ok: true, message: active ? "Technician activated." : "Technician deactivated." };
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "admin-technicians", action: "toggle-active" } });
    logger.error({ err, actor: admin.email, techId }, "technicians: toggle active failed");
    return { ok: false, error: err instanceof Error ? err.message : "Update failed." };
  }
}
