import { describe, expect, it } from "vitest";
import { sniffImageType } from "@/lib/security/image-sniff";

// The upload route validates the file's actual leading bytes, not just the
// client-claimed Content-Type. These cover the accepted formats plus the spoof
// case: an HTML/SVG payload (the classic "rename evil.html to evil.jpg") must
// NOT be accepted as an image.

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

describe("sniffImageType", () => {
  it("detects JPEG (FF D8 FF)", () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe("image/jpeg");
  });

  it("detects PNG", () => {
    expect(
      sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)),
    ).toBe("image/png");
  });

  it("detects WebP (RIFF....WEBP)", () => {
    const webp = new Uint8Array(16);
    webp.set(ascii("RIFF"), 0);
    webp.set(ascii("WEBP"), 8);
    expect(sniffImageType(webp)).toBe("image/webp");
  });

  it("detects HEIC (ftyp + heic brand)", () => {
    const heic = new Uint8Array(16);
    heic.set(ascii("ftyp"), 4);
    heic.set(ascii("heic"), 8);
    expect(sniffImageType(heic)).toBe("image/heic");
  });

  it("rejects an HTML payload spoofed as an image", () => {
    expect(sniffImageType(ascii("<!DOCTYPE html><script>alert(1)</script>"))).toBeNull();
  });

  it("rejects an SVG payload", () => {
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull();
  });

  it("rejects empty / too-short input", () => {
    expect(sniffImageType(bytes())).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull(); // JPEG needs 3 bytes
  });
});
