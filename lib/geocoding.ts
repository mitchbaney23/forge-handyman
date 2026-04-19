// Garner, NC — the center point we measure distance from.
export const SERVICE_AREA_CENTER = { lat: 35.7113, lng: -78.6141 };
export const DEFAULT_RADIUS_MILES = 15;

export type LatLng = { lat: number; lng: number };

export type ServiceAreaCheck =
  | { inArea: true; skipped?: boolean; distanceMiles?: number }
  | { inArea: false; distanceMiles: number; radiusMiles: number };

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMiles(a: LatLng, b: LatLng): number {
  const R = 3958.7613; // Earth radius in miles
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export async function geocodeAddress(
  address: string,
  apiKey: string,
): Promise<LatLng | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  // Bias toward North Carolina so ambiguous addresses (e.g. "Main St")
  // resolve near us instead of across the country.
  url.searchParams.set("components", "administrative_area:NC|country:US");

  const response = await fetch(url.toString(), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Geocoding HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    status: string;
    results: Array<{ geometry: { location: { lat: number; lng: number } } }>;
    error_message?: string;
  };

  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK") {
    throw new Error(
      `Geocoding status ${body.status}${body.error_message ? `: ${body.error_message}` : ""}`,
    );
  }

  const first = body.results[0];
  if (!first) return null;
  return first.geometry.location;
}

function getRadiusMiles(): number {
  const raw = process.env.SERVICE_AREA_RADIUS_MILES;
  if (!raw) return DEFAULT_RADIUS_MILES;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RADIUS_MILES;
}

/**
 * Decide whether a submitted address falls inside the service radius.
 *
 * Policy: fail open. If the API key isn't configured or Google returns an
 * error / no result, treat the submission as in-area so a real customer
 * never gets turned away by an API hiccup.
 */
export async function checkServiceArea(
  address: string,
): Promise<ServiceAreaCheck> {
  const apiKey = process.env.GOOGLE_GEOCODING_API_KEY;
  const radiusMiles = getRadiusMiles();

  if (!apiKey) {
    return { inArea: true, skipped: true };
  }

  let coords: LatLng | null;
  try {
    coords = await geocodeAddress(address, apiKey);
  } catch (err) {
    console.error("[geocoding] lookup failed:", err);
    return { inArea: true, skipped: true };
  }

  if (!coords) {
    return { inArea: true, skipped: true };
  }

  const distanceMiles = haversineMiles(SERVICE_AREA_CENTER, coords);

  if (distanceMiles > radiusMiles) {
    return { inArea: false, distanceMiles, radiusMiles };
  }

  return { inArea: true, distanceMiles };
}
