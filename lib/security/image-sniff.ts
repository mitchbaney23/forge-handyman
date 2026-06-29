// Magic-byte ("file signature") detection for the image formats the photo
// upload route accepts. The route also checks file.type, but that's the
// CLIENT-supplied Content-Type and is trivially spoofable — this validates the
// ACTUAL leading bytes so a non-image payload (an HTML/SVG/script file labelled
// image/jpeg) is rejected before it's ever stored. Defense in depth: uploads
// land on Google Drive (not our own domain), so this is hardening, not a
// load-bearing XSS gate — but it stops junk/spoofed content at the door.

export type SniffedImage = "image/jpeg" | "image/png" | "image/webp" | "image/heic";

// Known HEIF/HEIC ftyp brands (the major brand sits at bytes 8–11, right after
// the 'ftyp' box type). Covers iPhone HEIC plus the HEIF still-image brands.
const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "hevm",
  "hevs",
  "mif1",
  "msf1",
]);

// Returns the detected image type from the leading bytes, or null if the bytes
// don't match any accepted image format. `buf` need only contain the first ~16
// bytes; callers pass the whole file buffer.
export function sniffImageType(buf: Uint8Array): SniffedImage | null {
  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: 'RIFF' (0–3) .... 'WEBP' (8–11)
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  // HEIF/HEIC: 'ftyp' box type at bytes 4–7, a known brand at 8–11.
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 && // f
    buf[5] === 0x74 && // t
    buf[6] === 0x79 && // y
    buf[7] === 0x70 // p
  ) {
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    if (HEIF_BRANDS.has(brand)) return "image/heic";
  }
  return null;
}
