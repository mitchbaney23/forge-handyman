import * as Sentry from '@sentry/nextjs'
import {
  appendAuditRow,
  cancelAppointment,
  findRowByJobId,
  getAppointmentById,
  getTechnicianById,
  updateRowByJobId,
  type ContactRow,
} from '@/lib/data'
import { ACTIONS } from '@/lib/data/activity-actions'
import { deleteBookingEvent } from '@/lib/google'
import { notifyCancellation } from '@/lib/telegram/dispatch'
import { logger } from '@/lib/security/logger'

export type CancellationResult =
  | { ok: true; startsAt: string; endsAt: string }
  | { ok: false; reason: 'not_found' | 'already_cancelled' | 'error' }

// Cancel a booking from any entry point (admin button OR customer self-cancel
// link). Source of truth is the appointment row; cancelling it also removes the
// calendar event, flips the job to Cancelled, logs it, and tells David. Every
// step after the row flip is best-effort — a cancellation must succeed even if a
// downstream notification fails.
export async function performCancellation(
  appointmentId: string,
  actor: string,
): Promise<CancellationResult> {
  let appt
  try {
    appt = await cancelAppointment(appointmentId)
  } catch (err) {
    Sentry.captureException(err, { tags: { feature: 'cancel', step: 'cancel-row' } })
    logger.error({ err, appointmentId }, 'cancel: cancelAppointment failed')
    return { ok: false, reason: 'error' }
  }
  if (!appt) {
    // Row wasn't 'Booked' — distinguish "already cancelled" from "no such id"
    // for a friendlier message.
    const existing = await getAppointmentById(appointmentId).catch(() => null)
    return { ok: false, reason: existing ? 'already_cancelled' : 'not_found' }
  }

  // Remove the calendar event so the slot frees on David's calendar too.
  if (appt.googleEventId) {
    try {
      const tech = await getTechnicianById(appt.technicianId)
      if (tech?.calendarEmail) {
        await deleteBookingEvent({ subject: tech.calendarEmail, eventId: appt.googleEventId })
      }
    } catch (err) {
      // 404/410 (already gone) or transient — non-fatal.
      logger.warn({ err, appointmentId }, 'cancel: calendar event delete failed (non-fatal)')
    }
  }

  // Flip the job to Cancelled + notify David, both best-effort.
  let row: ContactRow | null = null
  if (appt.jobId) {
    try {
      const found = await findRowByJobId(appt.jobId)
      row = found?.row ?? null
    } catch {
      row = null
    }
    try {
      await updateRowByJobId(appt.jobId, { status: 'Cancelled' })
    } catch (err) {
      logger.warn({ err, jobId: appt.jobId }, 'cancel: job status update failed (non-fatal)')
    }
  }

  try {
    await appendAuditRow({
      actor,
      action: ACTIONS.APPOINTMENT_CANCELLED,
      target: appt.jobId || appt.id,
      jobId: appt.jobId || undefined,
      notes: `${appt.startsAt} → ${appt.endsAt}`,
    })
  } catch {
    // audit best-effort
  }

  if (row) {
    try {
      await notifyCancellation(row, { startsAt: appt.startsAt, endsAt: appt.endsAt }, actor)
    } catch (err) {
      logger.warn({ err, appointmentId }, 'cancel: David notification failed (non-fatal)')
    }
  }

  logger.info({ appointmentId, actor, jobId: appt.jobId }, 'cancel: booking cancelled')
  return { ok: true, startsAt: appt.startsAt, endsAt: appt.endsAt }
}
