import type { Metadata } from "next";
import Link from "next/link";
import { listTechnicians } from "@/lib/data";
import { getBackend } from "@/lib/data/backend";
import { TechnicianForm } from "./TechnicianForm";
import { TechnicianRowActions } from "./TechnicianRowActions";

export const metadata: Metadata = {
  title: "Team — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TechniciansPage() {
  const onPostgres = getBackend() === "postgres";
  const technicians = onPostgres ? await listTechnicians() : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-xs font-medium text-ink/60 hover:text-navy"
        >
          ← Back to overview
        </Link>
      </div>

      <header>
        <p className="eyebrow">Scheduling</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy">Team</h1>
        <p className="mt-2 text-sm text-ink/65">
          Each technician declares availability on their own Google Calendar;
          customers book inside it. Adding a technician here auto-creates their
          “Forge Availability” calendar — the replicable way to onboard the next
          hire.
        </p>
      </header>

      {!onPostgres ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Team management is available on the Postgres backend. This environment
          is running in sheet mode.
        </div>
      ) : (
        <>
          <TechnicianForm />

          <div className="rounded-xl border border-navy/10 bg-white shadow-card">
            <div className="border-b border-navy/10 px-6 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
                Technicians ({technicians.length})
              </h2>
            </div>
            {technicians.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-ink/50">
                No technicians yet. Add your first one above.
              </p>
            ) : (
              <ul className="divide-y divide-navy/10">
                {technicians.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-4 px-6 py-4"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-navy">{t.name}</span>
                        {!t.active && (
                          <span className="rounded bg-ink/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-ink/50">
                            Inactive
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-ink/60">{t.email}</p>
                      <p className="mt-1 text-xs text-ink/45">
                        {t.availabilityCalendarId ? (
                          <>Availability calendar: connected ✓</>
                        ) : (
                          <span className="text-amber-700">
                            No availability calendar — no bookable times until provisioned
                          </span>
                        )}
                        {!t.telegramChatId && <> · no Telegram ID</>}
                      </p>
                    </div>
                    <TechnicianRowActions
                      techId={t.id}
                      active={t.active}
                      hasCalendar={Boolean(t.availabilityCalendarId)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
