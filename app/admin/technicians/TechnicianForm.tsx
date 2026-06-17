"use client";

import { useState, useTransition } from "react";
import { addTechnician, type TechResult } from "./actions";

export function TechnicianForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<TechResult | null>(null);

  const submit = () => {
    setResult(null);
    startTransition(async () => {
      const res = await addTechnician({ name, email, telegramChatId });
      setResult(res);
      if (res.ok) {
        setName("");
        setEmail("");
        setTelegramChatId("");
      }
    });
  };

  const inputClass =
    "block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40";
  const labelClass =
    "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60";

  return (
    <div className="rounded-xl border border-navy/10 bg-white p-6 shadow-card">
      <h2 className="text-lg font-semibold text-navy">Add a technician</h2>
      <p className="mt-2 text-sm text-ink/70">
        Adds the technician and automatically creates their{" "}
        <span className="font-medium">“Forge Availability”</span> calendar — no
        Calendar IDs to copy. They (or you) then add open-window events to that
        calendar, and their primary-calendar events block conflicts.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tech-name" className={labelClass}>
            Name
          </label>
          <input
            id="tech-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setResult(null);
            }}
            placeholder="David Baney"
            disabled={pending}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tech-email" className={labelClass}>
            Workspace email
          </label>
          <input
            id="tech-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setResult(null);
            }}
            placeholder="david@forgehandyman.com"
            disabled={pending}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="tech-telegram" className={labelClass}>
            Telegram chat ID{" "}
            <span className="font-normal normal-case text-ink/40">(optional)</span>
          </label>
          <input
            id="tech-telegram"
            value={telegramChatId}
            onChange={(e) => {
              setTelegramChatId(e.target.value);
              setResult(null);
            }}
            placeholder="e.g. 123456789"
            disabled={pending}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-ink/50">
            For booking notifications. Leave blank for now if you don&rsquo;t have
            it yet.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        disabled={pending || !name.trim() || !email.trim()}
        className="btn-primary mt-4 disabled:opacity-50"
      >
        {pending ? "Adding…" : "Add technician"}
      </button>

      {result && (
        <p
          className={`mt-3 text-sm ${result.ok ? "text-green-700" : "text-red-600"}`}
          role={result.ok ? "status" : "alert"}
        >
          {result.ok ? result.message : result.error}
        </p>
      )}
    </div>
  );
}
