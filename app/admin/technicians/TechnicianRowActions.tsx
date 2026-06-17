"use client";

import { useState, useTransition } from "react";
import { provisionCalendar, setTechnicianActive, type TechResult } from "./actions";

export function TechnicianRowActions({
  techId,
  active,
  hasCalendar,
}: {
  techId: string;
  active: boolean;
  hasCalendar: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TechResult | null>(null);

  const run = (fn: () => Promise<TechResult>) => {
    setResult(null);
    startTransition(async () => setResult(await fn()));
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {!hasCalendar && (
          <button
            type="button"
            onClick={() => run(() => provisionCalendar(techId))}
            disabled={pending}
            className="rounded-md border border-navy/20 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
          >
            {pending ? "Working…" : "Provision calendar"}
          </button>
        )}
        <button
          type="button"
          onClick={() => run(() => setTechnicianActive(techId, !active))}
          disabled={pending}
          className="rounded-md border border-navy/20 px-2.5 py-1 text-xs font-semibold text-ink/70 hover:bg-navy/5 disabled:opacity-50"
        >
          {active ? "Deactivate" : "Activate"}
        </button>
      </div>
      {result && !result.ok && (
        <span className="text-xs text-red-600" role="alert">
          {result.error}
        </span>
      )}
      {result && result.ok && (
        <span className="text-xs text-green-700" role="status">
          {result.message}
        </span>
      )}
    </div>
  );
}
