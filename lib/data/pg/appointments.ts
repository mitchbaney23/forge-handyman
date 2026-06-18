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

export async function getAppointmentById(id: string): Promise<AppointmentRow | null> {
  if (!isUuid(id)) return null
  const client = getSupabaseClient()
  const { data, error } = await client.from('appointments').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`pg/appointments: getAppointmentById failed: ${error.message}`)
  return data ? mapAppointment(data as DbAppointmentRow) : null
}

// The live (Booked) appointment for a job, if any — used by the admin job page.
export async function getAppointmentByJobId(jobId: string): Promise<AppointmentRow | null> {
  if (!isUuid(jobId)) return null
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('appointments')
    .select('*')
    .eq('job_id', jobId)
    .eq('status', 'Booked')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`pg/appointments: getAppointmentByJobId failed: ${error.message}`)
  const rows = (data ?? []) as DbAppointmentRow[]
  return rows.length > 0 ? mapAppointment(rows[0]) : null
}

// Cancel an appointment (status -> 'Cancelled'); returns the row as it was so
// the caller can clean up the calendar event + job. Only flips a 'Booked' row
// (idempotent: a re-cancel returns null).
export async function cancelAppointment(id: string): Promise<AppointmentRow | null> {
  if (!isUuid(id)) return null
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('appointments')
    .update({ status: 'Cancelled' })
    .eq('id', id)
    .eq('status', 'Booked')
    .select('*')
    .maybeSingle()
  if (error) throw new Error(`pg/appointments: cancelAppointment failed: ${error.message}`)
  return data ? mapAppointment(data as DbAppointmentRow) : null
}

export async function getTechnicianById(id: string): Promise<TechnicianRow | null> {
  if (!isUuid(id)) return null
  const client = getSupabaseClient()
  const { data, error } = await client.from('technicians').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`pg/appointments: getTechnicianById failed: ${error.message}`)
  return data ? mapTechnician(data as DbTechnicianRow) : null
}

// The single active technician (David) until per-job assignment exists. v1
// resolves the first active tech for availability + booking.
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

// All technicians (admin team list), newest-managed first.
export async function listTechnicians(): Promise<TechnicianRow[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from('technicians')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw new Error(`pg/appointments: listTechnicians failed: ${error.message}`)
  return ((data ?? []) as DbTechnicianRow[]).map(mapTechnician)
}

// Create a technician. calendar_email defaults to their email (the
// @forgehandyman.com account the service account impersonates). The availability
// calendar is provisioned separately and linked via updateTechnician.
export async function createTechnician(args: {
  name: string
  email: string
  telegramChatId?: string
}): Promise<TechnicianRow> {
  const client = getSupabaseClient()
  const email = args.email.trim().toLowerCase()
  const { data, error } = await client
    .from('technicians')
    .insert({
      name: args.name.trim(),
      email,
      calendar_email: email,
      telegram_chat_id: (args.telegramChatId ?? '').trim(),
      active: true,
    })
    .select('*')
    .single()
  if (error) throw new Error(`pg/appointments: createTechnician failed: ${error.message}`)
  return mapTechnician(data as DbTechnicianRow)
}

// Patch a technician (link the provisioned availability calendar, toggle active,
// edit fields).
export async function updateTechnician(
  id: string,
  fields: {
    name?: string
    telegramChatId?: string
    calendarEmail?: string
    availabilityCalendarId?: string
    active?: boolean
  },
): Promise<void> {
  if (!isUuid(id)) return
  const update: Record<string, string | boolean> = {}
  if (fields.name != null) update.name = fields.name.trim()
  if (fields.telegramChatId != null) update.telegram_chat_id = fields.telegramChatId.trim()
  if (fields.calendarEmail != null) update.calendar_email = fields.calendarEmail.trim().toLowerCase()
  if (fields.availabilityCalendarId != null)
    update.availability_calendar_id = fields.availabilityCalendarId
  if (fields.active != null) update.active = fields.active
  if (Object.keys(update).length === 0) return
  const client = getSupabaseClient()
  const { error } = await client.from('technicians').update(update).eq('id', id)
  if (error) throw new Error(`pg/appointments: updateTechnician failed: ${error.message}`)
}
