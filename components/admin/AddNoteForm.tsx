"use client";

import { useState, useTransition } from "react";

// The server action this form invokes. Colocated with the page that renders it
// (the job detail page, built in a later stage) and passed in as a prop — this
// component never imports a page-level action directly. The action appends a
// `note.added` activity to the job's timeline and reports success.
export type AddNoteAction = (
  text: string,
) => Promise<{ ok: boolean; error?: string }>;

export interface AddNoteFormProps {
  action: AddNoteAction;
}

// Append-only timeline note (an event in the job's history). Distinct from
// EditNotesForm's standing notes: this clears on success because each submit is
// a new event, not an edit of a persistent field.
export function AddNoteForm({ action }: AddNoteFormProps) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const trimmed = text.trim();

  const handleAdd = () => {
    if (!trimmed || pending) return;
    setError(null);
    const next = trimmed;
    startTransition(async () => {
      const res = await action(next);
      if (res.ok) {
        setText("");
      } else {
        setError(res.error || "Couldn’t add the note.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={pending}
        rows={2}
        placeholder="Add a note to this job’s timeline…"
        aria-label="Add a timeline note"
        className="block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40 disabled:opacity-60"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleAdd}
          disabled={!trimmed || pending}
          className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy hover:border-navy hover:bg-navy hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-navy"
        >
          {pending ? "Adding…" : "Add note"}
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}
