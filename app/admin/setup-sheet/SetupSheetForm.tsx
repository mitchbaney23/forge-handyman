"use client";

import { useState, useTransition } from "react";
import { runSheetMigration, type MigrationResult } from "./actions";

export function SetupSheetForm({
  expectedColumnCount,
}: {
  expectedColumnCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const onRun = () => {
    setResult(null);
    setConfirming(false);
    startTransition(async () => {
      const res = await runSheetMigration();
      setResult(res);
    });
  };

  const steps = result
    ? result.ok
      ? result.steps
      : result.stepsBeforeFailure
    : [];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-navy/10 bg-white p-6 shadow-card">
        <h2 className="text-lg font-semibold text-navy">Run sheet migration</h2>
        <p className="mt-2 text-sm text-ink/70">
          Reads the current header row of <code className="rounded bg-navy/5 px-1 py-0.5 text-xs">Sheet1</code>.
          If it doesn&rsquo;t match the canonical {expectedColumnCount}-column
          schema, duplicates the current tab to <code className="rounded bg-navy/5 px-1 py-0.5 text-xs">backup-{"{timestamp}"}</code>,
          writes the new headers, and ensures the <code className="rounded bg-navy/5 px-1 py-0.5 text-xs">Audit</code> tab
          exists. Idempotent — safe to re-run.
        </p>

        {!confirming && !pending && !result && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="btn-primary mt-4"
          >
            Run sheet migration
          </button>
        )}

        {confirming && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-medium text-amber-900">
              Confirm: this will modify your master sheet.
            </p>
            <p className="mt-1 text-xs text-amber-900/80">
              The current Sheet1 tab will be duplicated as a backup before
              headers are rewritten. Your data rows are preserved on the
              backup tab.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={onRun}
                className="rounded-md bg-amber-forge px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-forge-dark"
              >
                Yes, run it
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {pending && (
          <div className="mt-4 flex items-center gap-2 text-sm text-ink/70">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-amber-forge"></span>
            Running… this takes a few seconds.
          </div>
        )}
      </div>

      {result && (
        <div
          className={`rounded-xl border p-6 shadow-card ${
            result.ok
              ? "border-emerald-200 bg-emerald-50"
              : "border-red-200 bg-red-50"
          }`}
        >
          <h3
            className={`text-lg font-semibold ${
              result.ok ? "text-emerald-900" : "text-red-900"
            }`}
          >
            {result.ok
              ? result.noOp
                ? "No migration needed — schema already current."
                : "Migration applied successfully."
              : "Migration failed."}
          </h3>
          {!result.ok && (
            <p className="mt-1 text-sm text-red-900/85">{result.error}</p>
          )}
          {steps.length > 0 && (
            <ol className="mt-4 space-y-2 text-sm">
              {steps.map((step, idx) => (
                <li key={idx} className="flex gap-3">
                  <StepIcon status={step.status} />
                  <div className="flex-1">
                    <div className="font-medium text-ink/90">{step.label}</div>
                    {step.note && (
                      <div className="text-xs text-ink/65">{step.note}</div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setConfirming(false);
              }}
              className="rounded-md border border-navy/15 bg-white px-3 py-1.5 text-xs font-medium text-navy hover:border-navy hover:bg-navy hover:text-white"
            >
              Close
            </button>
            {!result.ok && (
              <button
                type="button"
                onClick={onRun}
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StepIcon({ status }: { status: "done" | "skipped" | "failed" }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 0 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0z"
            clipRule="evenodd"
          />
        </svg>
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-300 text-white">
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
          <path d="M5 10h10" stroke="currentColor" strokeWidth="2" />
        </svg>
      </span>
    );
  }
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold">
      !
    </span>
  );
}
