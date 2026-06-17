"use client";

import { useState, useTransition } from "react";
import { cancelByToken, type CancelByTokenResult } from "./actions";

export function CancelByTokenButton({
  token,
  whenLabel,
}: {
  token: string;
  whenLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<CancelByTokenResult | null>(null);

  const run = () => {
    setResult(null);
    startTransition(async () => setResult(await cancelByToken(token)));
  };

  if (result?.ok) {
    return (
      <p className="text-[15px] font-semibold text-[#1d4039]">
        Your appointment on {whenLabel} is cancelled. Thanks for letting us know!
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="rounded-[7px] border-2 border-ink bg-white px-5 py-2.5 text-[15px] font-bold text-ink hover:bg-paper-2"
        >
          Cancel my appointment
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-[14px] text-ink-2">
            Cancel your appointment on <span className="font-semibold">{whenLabel}</span>?
          </p>
          <div className="flex justify-center gap-2.5">
            <button
              type="button"
              onClick={run}
              disabled={pending}
              className="rounded-[7px] border-2 border-ink bg-ink px-5 py-2.5 text-[15px] font-bold text-white disabled:opacity-50"
            >
              {pending ? "Cancelling…" : "Yes, cancel it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-[7px] border-2 border-line px-5 py-2.5 text-[15px] font-bold text-ink hover:bg-paper-2 disabled:opacity-50"
            >
              Keep it
            </button>
          </div>
        </div>
      )}
      {result && !result.ok && (
        <p className="text-[13.5px] font-semibold text-red" role="alert">
          {result.error}
        </p>
      )}
    </div>
  );
}
