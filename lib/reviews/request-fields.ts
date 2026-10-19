import { SERVICE_LABEL_BY_CODE, type ServiceCategoryCode } from "@/lib/constants";

// What the review-request email says about the job ("your TV mounting project
// in Garner"), shared by the daily review cron and the job page's Send review
// request button.

// Best-effort city from a US street address: "12 Oak St, Garner, NC 27529" ->
// "Garner"; a trailing country segment is dropped first.
export function reviewCityFrom(address: string): string | undefined {
  if (!address) return undefined;
  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  while (
    parts.length > 0 &&
    /^(USA|U\.S\.A\.|United States|US|U\.S\.)$/i.test(parts[parts.length - 1])
  ) {
    parts.pop();
  }
  if (parts.length === 0) return undefined;
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) {
    return /^\d/.test(parts[0]) ? parts[1] : parts[0];
  }
  return parts[0];
}

// The job's service in a few words: its one booked category, "punch list" for
// several, else the service type.
export function reviewServiceLabel(row: { service_categories?: string; service_type?: string }): string {
  const categories = (row.service_categories || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ServiceCategoryCode[];
  if (categories.length === 1) {
    return SERVICE_LABEL_BY_CODE[categories[0]] ?? row.service_type ?? "project";
  }
  if (categories.length >= 2) return "punch list";
  const code = row.service_type as ServiceCategoryCode;
  return SERVICE_LABEL_BY_CODE[code] ?? row.service_type ?? "project";
}
