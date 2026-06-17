// Scheduling rules NOT owned by the calendar. The *when David is open* windows
// come from his Google Calendar (see lib/scheduling/availability.ts); these are
// the slot-shaping knobs the calendar doesn't express.
//
// Deliberately small + centralized so tuning the booking experience is a
// one-file change. There is intentionally NO weekday/hours table here — that
// lives in the technician's calendar so it can change without a redeploy
// (and so it generalizes per-employee).

// Candidate slot start times are generated on this minute boundary (e.g. 30 =>
// :00 and :30). Combined with availability windows that themselves start on a
// clean boundary, slots land on tidy times.
export const SLOT_GRANULARITY_MIN = 30

// Padding added AFTER each job (travel/cleanup) when checking a slot against
// busy intervals, and between back-to-back bookings. Not billed; just spacing.
export const TRAVEL_BUFFER_MIN = 30

// Minimum notice before a slot can start. Same-day booking is allowed, but not
// in the next two hours (gives the tech a heads-up and prevents "booked for 5
// minutes from now").
export const MIN_LEAD_MIN = 120

// How far ahead customers can book.
export const BOOKING_WINDOW_DAYS = 30

// Single market (NC Triangle). All slot display + day bucketing is Eastern.
export const TIME_ZONE = 'America/New_York'

// A bundled view of the knobs, handy to pass into the pure slot algorithm and to
// override in tests.
export type SchedulingConfig = {
  slotGranularityMin: number
  travelBufferMin: number
  minLeadMin: number
  bookingWindowDays: number
}

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = {
  slotGranularityMin: SLOT_GRANULARITY_MIN,
  travelBufferMin: TRAVEL_BUFFER_MIN,
  minLeadMin: MIN_LEAD_MIN,
  bookingWindowDays: BOOKING_WINDOW_DAYS,
}
