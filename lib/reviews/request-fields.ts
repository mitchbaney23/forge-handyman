// The town a review email names ("your project in Clayton"), shared by the
// daily review cron and the job page's Send review request button. The job
// itself is not named: the booking-form category labels read badly in a
// sentence ("your Mounting & assembly (TVs, shelves, furniture) project").

const COUNTRY = /^(USA|U\.S\.A\.|United States|US|U\.S\.)$/i;
// "NC", "NC 27529", "27529", "NC 27529-1234"
const STATE_ZIP_ONLY = /^([A-Z]{2})?\s*(\d{5}(-\d{4})?)?$/i;
// "Raleigh NC 27603" / "Clayton NC" -> "Raleigh" / "Clayton"
const TRAILING_STATE_ZIP = /\s+[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/i;

// The town from a US address as people actually type it:
//   "12 Oak St, Garner, NC 27529"   -> "Garner"
//   "12 Oak St, Raleigh NC 27603"   -> "Raleigh"
//   "12 Oak St, Clayton NC"         -> "Clayton"
//   "12 Oak St, Clayton, NC, USA"   -> "Clayton"
// undefined when no town can be told apart from the street ("12 Oak St", or
// "12 Oak St Clayton NC" with no commas), so the email says "your project".
export function reviewCityFrom(address: string): string | undefined {
  if (!address) return undefined;
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  while (parts.length > 0 && COUNTRY.test(parts[parts.length - 1])) parts.pop();
  // A trailing "NC 27529" on its own: the town is the part before it.
  while (parts.length > 0 && STATE_ZIP_ONLY.test(parts[parts.length - 1])) parts.pop();
  if (parts.length === 0) return undefined;
  const town = parts[parts.length - 1].replace(TRAILING_STATE_ZIP, "").trim();
  // A street ("12 Oak St") is not a town.
  if (!town || /^\d/.test(town)) return undefined;
  // Typed all lowercase ("raleigh"): capitalize it for the email.
  return town === town.toLowerCase()
    ? town.replace(/(^|[\s-])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase())
    : town;
}
