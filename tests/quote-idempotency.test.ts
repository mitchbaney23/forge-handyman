import { describe, expect, it } from "vitest";
import { quoteContentHash } from "@/lib/stripe/payment-links";

// Regression test for the Stripe "Keys for idempotent requests can only be used
// with the same parameters" error on re-quoting. The quote idempotency keys are
// jobId + quoteContentHash(...), so the hash MUST be stable for an identical
// quote (safe dedupe of a double-click) and MUST change when any price-shaping
// field changes (so an edited re-quote gets fresh keys instead of colliding).

const base = {
  description: "Mounting & assembly · Drywall, painting, or trim",
  tier: "medium" as const,
  depositCents: 143000,
  balanceCents: 0,
  customerEmail: "braden.forgesites@gmail.com",
};

describe("quoteContentHash", () => {
  it("is stable for an identical quote (a re-submit safely dedupes)", () => {
    expect(quoteContentHash(base)).toBe(quoteContentHash({ ...base }));
  });

  it("changes when the deposit amount changes (the bug Braden hit)", () => {
    // $1430 first send, then re-quoted at $1 — must not collide.
    expect(quoteContentHash(base)).not.toBe(
      quoteContentHash({ ...base, depositCents: 100 }),
    );
  });

  it("changes when any other price-shaping field changes", () => {
    const h = quoteContentHash(base);
    expect(h).not.toBe(quoteContentHash({ ...base, balanceCents: 50000 }));
    expect(h).not.toBe(quoteContentHash({ ...base, tier: "large" }));
    expect(h).not.toBe(quoteContentHash({ ...base, description: "Different scope" }));
    expect(h).not.toBe(quoteContentHash({ ...base, customerEmail: "other@example.com" }));
  });

  it("returns a short hex fingerprint (fits well within Stripe's key limit)", () => {
    expect(quoteContentHash(base)).toMatch(/^[0-9a-f]{16}$/);
  });
});
