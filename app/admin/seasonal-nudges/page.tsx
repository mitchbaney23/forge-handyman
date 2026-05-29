import type { Metadata } from "next";
import Link from "next/link";
import { NudgeCard } from "./NudgeCard";
import { findNudgeCandidates } from "@/lib/automation/nudges";

export const metadata: Metadata = {
  title: "Seasonal nudges — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SeasonalNudgesPage() {
  let candidates: Awaited<ReturnType<typeof findNudgeCandidates>> = [];
  let loadError: string | null = null;
  try {
    candidates = await findNudgeCandidates();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  // Server component, runs per-request — Date.now() is intentional here.
  // eslint-disable-next-line react-hooks/purity -- per-request server render
  const now = Date.now();

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <div className="font-semibold">Couldn&rsquo;t load nudge candidates.</div>
        <div className="mt-2 font-mono text-xs">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-xs font-medium text-ink/60 hover:text-navy"
        >
          ← Back to overview
        </Link>
      </div>

      <header>
        <p className="eyebrow">Follow-up</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy sm:text-3xl">
          Seasonal nudges
        </h1>
        <p className="mt-2 text-sm text-ink/65">
          Customers whose last completed job was 180+ days ago, with no nudge
          sent in the last 180 days, sorted by staleness. Each card is
          pre-filled with a template based on what they hired us for last
          time — edit before sending if you want. Unsubscribe footer is
          appended automatically.
        </p>
      </header>

      {candidates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-navy/15 bg-white/60 p-10 text-center text-sm text-ink/55">
          No nudge candidates today. Check back when more jobs cross the
          180-day mark.
        </div>
      ) : (
        <div className="space-y-4">
          {candidates.map((c) => {
            const days = c.lastJobDate
              ? Math.floor(
                  (now - new Date(c.lastJobDate).getTime()) /
                    (24 * 60 * 60 * 1000),
                )
              : 0;
            return (
              <NudgeCard
                key={c.email}
                daysSinceLastJob={days}
                candidate={{
                  ...c,
                  template: {
                    subject: c.template.subject,
                    body: c.template.body,
                  },
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
