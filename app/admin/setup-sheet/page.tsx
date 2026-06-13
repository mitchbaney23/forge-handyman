import type { Metadata } from "next";
import Link from "next/link";
import { SetupSheetForm } from "./SetupSheetForm";
import { getBackend } from "@/lib/data/backend";
import { SHEET_HEADERS, readHeaderRow } from "@/lib/sheet/repo";

export const metadata: Metadata = {
  title: "Sheet migration — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export default async function SetupSheetPage() {
  const expected = Array.from(SHEET_HEADERS);

  // Retired in postgres mode: this tool managed the Google Sheet schema, which
  // is no longer the data backend. Render a short notice and run NO sheet reads.
  if (getBackend() === "postgres") {
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
          <p className="eyebrow">Maintenance</p>
          <h1 className="mt-1 text-2xl font-semibold text-navy">
            Sheet schema migration
          </h1>
        </header>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
          Retired — the data backend is Postgres now; this tool managed the
          Google Sheet schema.
        </section>
      </div>
    );
  }

  let current: string[] = [];
  let loadError: string | null = null;
  try {
    current = await readHeaderRow();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const matchesCanonical = !loadError && arraysEqual(current, expected);

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
        <p className="eyebrow">Maintenance</p>
        <h1 className="mt-1 text-2xl font-semibold text-navy">
          Sheet schema migration
        </h1>
        <p className="mt-2 text-sm text-ink/65">
          Apply the canonical column schema to your master Google Sheet.
          Runs entirely server-side using the production service-account
          credentials — no local env file or terminal needed.
        </p>
      </header>

      <section className="rounded-xl border border-navy/10 bg-white p-6 shadow-card">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">
          Current status
        </h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink/70">Canonical schema</dt>
            <dd className="font-medium text-ink/90">
              {expected.length} columns
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink/70">Current sheet</dt>
            <dd className="font-medium text-ink/90">
              {loadError
                ? "Could not read"
                : `${current.length} column${current.length === 1 ? "" : "s"}`}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink/70">Match</dt>
            <dd>
              {loadError ? (
                <span className="text-red-700">Error</span>
              ) : matchesCanonical ? (
                <span className="font-medium text-emerald-700">
                  ✓ Up to date
                </span>
              ) : (
                <span className="font-medium text-amber-800">
                  Migration needed
                </span>
              )}
            </dd>
          </div>
        </dl>
        {loadError && (
          <p className="mt-3 font-mono text-xs text-red-700">{loadError}</p>
        )}
      </section>

      <SetupSheetForm expectedColumnCount={expected.length} />

      <details className="text-sm">
        <summary className="cursor-pointer text-ink/70 hover:text-navy">
          Show canonical schema ({expected.length} columns)
        </summary>
        <ol className="mt-3 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {expected.map((col, i) => (
            <li
              key={col}
              className="rounded border border-navy/10 bg-white px-2 py-1 font-mono text-xs"
            >
              <span className="text-ink/50">{columnLetter(i)}</span>{" "}
              <span className="text-ink/90">{col}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function columnLetter(index: number): string {
  let n = index;
  let result = "";
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
