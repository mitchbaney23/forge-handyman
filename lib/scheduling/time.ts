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

// An Eastern wall-clock time ('YYYY-MM-DD' + 'HH:MM', as a date and a time
// input give them) to the UTC instant, DST-correct. null when either part is
// malformed or the time does not exist (the skipped hour of spring-forward).
export function easternWallTimeToIso(date: string, time: string): string | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return null
  const [y, mo, da] = [Number(d[1]), Number(d[2]), Number(d[3])]
  const [h, mi] = [Number(t[1]), Number(t[2])]
  if (h > 23 || mi > 59) return null
  const wall = Date.UTC(y, mo - 1, da, h, mi)
  if (new Date(wall).getUTCDate() !== da) return null
  // Read the guess back in Eastern; the gap is the offset. Twice, so a guess
  // that lands across a DST change settles on the right side.
  let instant = wall
  for (let i = 0; i < 2; i++) instant = wall - (easternWallMs(instant) - instant)
  return easternWallMs(instant) === wall ? new Date(instant).toISOString() : null
}

function easternWallMs(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'))
}
