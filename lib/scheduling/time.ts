// Eastern-time primitives for scheduling. Forge serves the NC Triangle, so all
// "what day is this slot on" bucketing and all customer-facing time display is
// Eastern, regardless of the server's UTC clock.
//
// These were originally in lib/sheet/queries.ts; they now live here so the
// scheduling code doesn't depend on the sheet module. queries.ts re-exports
// isSameLocalDay/toLocalIsoDate for back-compat.
//
// Design note: the slot algorithm (lib/scheduling/slots.ts) works on absolute
// instants (epoch ms) — availability windows and busy intervals both arrive as
// real timestamps from Google. That makes the interval math inherently
// DST-correct; Eastern time only matters here for *labeling* a slot's day and
// formatting its time for humans.

export const ET_TIME_ZONE = 'America/New_York'

// The YYYY-MM-DD calendar date of `d` in Eastern time. 'en-CA' formats as
// ISO-style YYYY-MM-DD.
export function easternIsoDate(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: ET_TIME_ZONE })
}

export function isSameLocalDay(isoDate: string, comparison: Date): boolean {
  if (!isoDate) return false
  // date-only YYYY-MM-DD (e.g. a customer's intended day) vs an instant.
  return isoDate.slice(0, 10) === easternIsoDate(comparison)
}

export function toLocalIsoDate(d: Date): string {
  return easternIsoDate(d)
}

// Human display, Eastern: "10:00 AM".
export function formatEtTime(d: Date): string {
  return d.toLocaleTimeString('en-US', {
    timeZone: ET_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Human display, Eastern: "Sat, Jun 21".
export function formatEtDay(d: Date): string {
  return d.toLocaleDateString('en-US', {
    timeZone: ET_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}
