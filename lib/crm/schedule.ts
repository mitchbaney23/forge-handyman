import {
  appendAuditRow,
  claimSlot,
  findRowByJobId,
  getAppointmentByJobId,
  getDefaultTechnician,
  linkAppointment,
  listAppointmentsInRange,
  releaseSlot,
  updateRowByJobId,
  type ContactRow,
  type TechnicianRow,
} from "@/lib/data";
import { ACTIONS } from "@/lib/data/activity-actions";
import { sendScheduledNotice, type ScheduledNoticeInput } from "@/lib/email/office-notice";
import {
  createBookingEvent,
  sendBookingConfirmationToCustomer,
  type ContactSubmission,
} from "@/lib/google";
import { canAdminTransition } from "@/lib/jobs/status-machine";
import { isForgeFamilyJob } from "@/lib/quote-lines";
import { buildCancelUrl } from "@/lib/scheduling/cancel-token";
import { operationsCalendarEmail } from "@/lib/scheduling/config";
import {
  easternIsoDate,
  easternWallTimeToIso,
  formatEtDay,
  formatEtTime,
} from "@/lib/scheduling/time";
import { logger } from "@/lib/security/logger";

// ---------------------------------------------------------------------------
// Schedule a job from the admin (or Claude): a firm appointment at a time the
// person picked, put on the operations@ Google Calendar, and the job moved to
// Booked. Same shape as the other CRM cores (lib/crm/mutations.ts): no next/*,
// no session, an explicit actor; each caller owns auth and revalidation.
//
// The appointment row is recorded against the default technician (David) the
// same way a website booking is, so the website's slot picker treats that
// time as taken and the job page, today_schedule and the day-before customer
// reminder all see it. Unlike a website booking the calendar event goes on
// the operations calendar, not David's, and the appointment is marked
// source 'admin' so a later cancel deletes the event from the right calendar.
// The customer gets the website's "You're booked" confirmation (date, time,
// address, a cancel link) unless the sender turns it off, and the day-before
// reminder from the lifecycle cron like any booking. The office (admin@ +
// operations@) gets a notice to check it. David is not messaged; dispatch him
// from the job page as usual.
// ---------------------------------------------------------------------------

export const MIN_APPOINTMENT_MIN = 30;
export const MAX_APPOINTMENT_MIN = 12 * 60;

export type ScheduleCheck =
  | { ok: true; technician: TechnicianRow }
  | { ok: false; error: string };

// The checks that need no job: a sane window in the future, a technician to
// book it against, and no live booking overlapping it. createJobForCustomer
// runs this BEFORE creating the job so a taken time does not leave a stray
// unscheduled job behind; scheduleJob runs it again at claim time.
export async function checkScheduleWindow(args: {
  startsAt: string;
  endsAt: string;
  now?: Date;
}): Promise<ScheduleCheck> {
  const start = Date.parse(args.startsAt);
  const end = Date.parse(args.endsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, error: "Pick a date and a start time." };
  }
  const minutes = (end - start) / 60_000;
  if (minutes < MIN_APPOINTMENT_MIN || minutes > MAX_APPOINTMENT_MIN) {
    return { ok: false, error: "An appointment runs between 30 minutes and 12 hours." };
  }
  const now = (args.now ?? new Date()).getTime();
  if (start < now) {
    return { ok: false, error: "That time has already passed. Pick a time later than now." };
  }

  const technician = await getDefaultTechnician();
  if (!technician) {
    return { ok: false, error: "No active technician is set up, so there is no one to book." };
  }

  const overlapping = await listAppointmentsInRange(
    new Date(start).toISOString(),
    new Date(end).toISOString(),
  );
  if (overlapping.length > 0) {
    const first = overlapping[0];
    return {
      ok: false,
      error: `That overlaps another booking: ${describeWindow(first.startsAt, first.endsAt)}. Pick another time.`,
    };
  }
  return { ok: true, technician };
}

export type ScheduleJobResult =
  | {
      ok: true;
      appointmentId: string;
      startsAt: string;
      endsAt: string;
      calendar: string;
      // What happened with the customer's confirmation email.
      confirmation: ScheduledNoticeInput["confirmation"];
      message: string;
    }
  | { ok: false; error: string };

export async function scheduleJob(args: {
  jobId: string;
  startsAt: string;
  endsAt: string;
  actor: string;
  // Email the customer a confirmation. Default true.
  emailCustomer?: boolean;
  now?: Date;
}): Promise<ScheduleJobResult> {
  const { jobId, actor } = args;
  const found = await findRowByJobId(jobId);
  if (!found) return { ok: false, error: "Job not found" };
  const row = found.row;

  const current = await getAppointmentByJobId(jobId);
  if (current) {
    return {
      ok: false,
      error: `This job is already scheduled for ${describeWindow(current.startsAt, current.endsAt)}. Cancel that appointment on the job page first.`,
    };
  }
  if (row.status !== "Booked" && !canAdminTransition(row.status, "Booked")) {
    return { ok: false, error: `A job that is ${row.status} can't be scheduled.` };
  }

  const check = await checkScheduleWindow(args);
  if (!check.ok) return check;

  const startsAt = new Date(args.startsAt).toISOString();
  const endsAt = new Date(args.endsAt).toISOString();
  const appt = await claimSlot({
    jobId,
    technicianId: check.technician.id,
    startsAt,
    endsAt,
  });
  if (!appt) {
    return { ok: false, error: "That time was just taken. Pick another time." };
  }

  const calendar = operationsCalendarEmail();
  let eventId = "";
  try {
    eventId = await createBookingEvent({
      subject: calendar,
      startsAt,
      endsAt,
      data: submissionFor(row, jobId),
    });
  } catch (err) {
    logger.error({ err, jobId, calendar }, "crm: schedule calendar event failed");
    await releaseSlot(appt.id).catch(() => {});
    return {
      ok: false,
      error: `Couldn't add it to the ${calendar} Google Calendar, so nothing was scheduled. Try again in a minute.`,
    };
  }

  try {
    await linkAppointment(appt.id, { googleEventId: eventId, source: "admin" });
  } catch (err) {
    // The booking stands; only a later cancel would miss the calendar event.
    logger.error({ err, jobId, appointmentId: appt.id }, "crm: linkAppointment failed (non-fatal)");
  }

  const before = row.status;
  await updateRowByJobId(jobId, {
    status: "Booked",
    preferred_date: easternIsoDate(new Date(startsAt)),
  });
  await appendAuditRow({
    actor,
    action: ACTIONS.APPOINTMENT_SCHEDULED,
    target: jobId,
    jobId,
    notes: `${startsAt} → ${endsAt} · ${calendar} calendar`,
  });
  if (before !== "Booked") {
    await appendAuditRow({
      actor,
      action: ACTIONS.JOB_STATUS_CHANGED,
      target: jobId,
      jobId,
      before,
      after: "Booked",
    });
  }
  logger.info({ jobId, actor, startsAt, endsAt, calendar }, "crm: job scheduled");

  // The booking stands from here; both emails are best-effort.
  const submission = submissionFor(row, jobId);
  let confirmation: ScheduledNoticeInput["confirmation"] = "skipped";
  if (args.emailCustomer !== false) {
    if (!row.email) {
      confirmation = "no-email";
    } else {
      try {
        await sendBookingConfirmationToCustomer({
          data: submission,
          startsAt,
          endsAt,
          cancelUrl: buildCancelUrl(appt.id),
        });
        confirmation = "sent";
      } catch (err) {
        confirmation = "failed";
        logger.warn({ err, jobId }, "crm: schedule confirmation email failed (non-fatal)");
      }
    }
  }
  const whenLabel = describeWindow(startsAt, endsAt);
  try {
    await sendScheduledNotice({
      jobId,
      customerName: row.name,
      customerEmail: row.email,
      serviceType: row.service_type,
      address: row.address,
      whenLabel,
      calendar,
      confirmation,
      actor,
    });
  } catch (err) {
    logger.warn({ err, jobId }, "crm: schedule office notice failed (non-fatal)");
  }

  const confirmationNote: Record<ScheduledNoticeInput["confirmation"], string> = {
    sent: ` Confirmation emailed to ${row.email}.`,
    failed: " The confirmation email to the customer failed; let them know the time.",
    "no-email": " No email on file, so no confirmation went out; let them know the time.",
    skipped: " No confirmation emailed, as you chose.",
  };
  return {
    ok: true,
    appointmentId: appt.id,
    startsAt,
    endsAt,
    calendar,
    confirmation,
    message: `Scheduled for ${whenLabel} on the ${calendar} calendar.${confirmationNote[confirmation]}`,
  };
}

// What the forms and the MCP tools send (an Eastern date, start time and
// length) as the booking window, or null when the date/time is not a real
// Eastern time or the length is not a positive number of minutes.
export function easternWindow(input: {
  date: string;
  startTime: string;
  durationMinutes: number;
}): { startsAt: string; endsAt: string } | null {
  const startsAt = easternWallTimeToIso(input.date, input.startTime);
  const minutes = Number(input.durationMinutes);
  if (!startsAt || !Number.isFinite(minutes) || minutes <= 0) return null;
  return { startsAt, endsAt: new Date(Date.parse(startsAt) + minutes * 60_000).toISOString() };
}

// "Tue, Oct 20, 10:00 AM–12:00 PM" in Eastern time.
export function describeWindow(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  return `${formatEtDay(start)}, ${formatEtTime(start)}–${formatEtTime(new Date(endsAt))}`;
}

function submissionFor(row: ContactRow, jobId: string): ContactSubmission {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    serviceType: row.service_type,
    preferredDate: row.preferred_date,
    description: row.description,
    referralSource: row.referral_source,
    submittedAt: row.submitted_at,
    jobId,
    family: isForgeFamilyJob(row.description),
  };
}
