import { getSupabaseClient } from '@/lib/data/pg/client'
import { isUuid } from '@/lib/data/pg/mappers'

// Postgres appointments layer — Phase C (self-scheduling). The appointments
// table is the DURABLE anti-double-booking guard: a partial unique index allows
// at most one live ('Booked') appointment per (technician_id, starts_at), and
// the claim_slot RPC inserts a row or returns nothing on conflict — "nothing" is
// the gate (exactly mirrors the payments double-charge guard). Google free/busy
// is a second, advisory layer re-checked at booking time.
// See supabase/migrations/20260617120000_appointments.sql.
//
// Postgres-only: in sheet mode lib/data/index.ts no-ops these.

export interface AppointmentRow {
  id: string
  jobId: string
  technicianId: string
  startsAt: string
  endsAt: string
  status: string
  googleEventId: string
  source: string
  createdAt: string
}

export interface TechnicianRow {
  id: string
  name: string
  phone: string
  email: string
  calendarEmail: string
  availabilityCalendarId: string
  telegramChatId: string
  active: boolean
}

interface DbAppointmentRow {
  id: string
  job_id: string | null
  technician_id: string | null
  starts_at: string | null
  ends_at: string | null
  status: string | null
  google_event_id: string | null
  source: string | null
  created_at: string | null
}

interface DbTechnicianRow {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  calendar_email: string | null
  availability_calendar_id: string | null
  telegram_chat_id: string | null
  active: boolean | null
}

function mapAppointment(row: DbAppointmentRow): AppointmentRow {
  return {
    id: row.id,
    jobId: row.job_id ?? '',
    technicianId: row.technician_id ?? '',
    startsAt: row.starts_at ? new Date(row.starts_at).toISOString() : '',
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : '',
    status: row.status ?? '',
    googleEventId: row.google_event_id ?? '',
    source: row.source ?? '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
  }
}

function mapTechnician(row: DbTechnicianRow): TechnicianRow {
  return {
    id: row.id,
    name: row.name ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    calendarEmail: row.calendar_email ?? '',
    availabilityCalendarId: row.availability_calendar_id ?? '',
    telegramChatId: row.telegram_chat_id ?? '',
    active: row.active ?? false,
  }
}

// Atomically claim a slot. Returns the new 'Booked' row when this call WON the
// gate, or null when a live booking already exists for (technician, starts_at)
// — the caller must NOT proceed (ask the customer to repick). The event id is
// usually set AFTER the calendar event is created (see setAppointmentEvent).
export async function claimSlot(args: {
  jobId: string
  technicianId: string
  startsAt: string
  endsAt: string
  googleEventId?: string
}): Promise<AppointmentRow | null> {
  if (!isUuid(args.technicianId)) return null
  const client = getSupabaseClient()
  const { data, error } = await client.rpc('claim_slot', {
    p_job_id: isUuid(args.jobId) ? args.jobId : null,
    p_tech: args.technicianId,
    p_starts: args.startsAt,
    p_ends: args.endsAt,
    p_event: args.googleEventId ?? '',
  })
  if (error) throw new Error(`pg/appointments: claim_slot failed: ${error.message}`)
  // setof appointments => [] on conflict, [row] on insert. Only a row with a
  // real id means WE won the gate (mirrors claimChargeAttempt's hardening).
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as DbAppointmentRow[]
  const row = rows.find((r) => r && r.id) ?? null
  return row ? mapAppointment(row) : null
}

// Link a claimed appointment to its job and/or calendar event after they exist.
// The slot is claimed with a null job_id (before the jobs row is written, to
// fail fast on a taken slot without leaving a dangling job); this sets job_id
// once the jobs row exists, plus the Google event id for later reschedule/cancel.
export async function linkAppointment(
  id: string,
  fields: { jobId?: string; googleEventId?: string },
): Promise<void> {
  if (!isUuid(id)) return
  const update: Record<string, string> = {}
  if (fields.jobId && isUuid(fields.jobId)) update.job_id = fields.jobId
  if (fields.googleEventId != null) update.google_event_id = fields.googleEventId
  if (Object.keys(update).length === 0) return
  const client = getSupabaseClient()
  const { error } = await client.from('appointments').update(update).eq('id', id)
  if (error) throw new Error(`pg/appointments: linkAppointment failed: ${error.message}`)
}

// Release a claimed slot (status -> 'Cancelled'), which drops it out of the
// unique index so the slot frees. Used to compensate when calendar-event
// creation fails after a successful claim.
export async function releaseSlot(id: string): Promise<void> {
  if (!isUuid(id)) return
  const client = getSupabaseClient()
  const { error } = await client
    .from('appointments')
    .update({ status: 'Cancelled' })
    .eq('id', id)
  if (error) throw new Error(`pg/appointments: releaseSlot failed: ${error.message}`)
}

// Booked appointments overlapping [fromIso, toIso) — the existing-bookings half
// of the slot algorithm's busy set.
export async function listAppointmentsInRange(
  fromIso: string,
  toIso: string,
): Promise<AppointmentRow[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('appointments')
    .select('*')
    .eq('status', 'Booked')
    .lt('starts_at', toIso)
    .gt('ends_at', fromIso)
    .order('starts_at', { ascending: true })
  if (error) throw new Error(`pg/appointments: listAppointmentsInRange failed: ${error.message}`)
  return ((data ?? []) as DbAppointmentRow[]).map(mapAppointment)
}

// The single active technician (David) until a multi-tech assignment UI exists.
export async function getDefaultTechnician(): Promise<TechnicianRow | null> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('technicians')
    .select('*')
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(`pg/appointments: getDefaultTechnician failed: ${error.message}`)
  const rows = (data ?? []) as DbTechnicianRow[]
  return rows.length > 0 ? mapTechnician(rows[0]) : null
}
