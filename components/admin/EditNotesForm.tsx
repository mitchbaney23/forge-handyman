"use client";

import { useState, useTransition } from "react";

// The server action this form invokes. Colocated with the page that renders it
// (built in a later stage) and passed in as a prop — this component never
// imports a page-level action directly. The action persists the standing notes
// for one customer and reports whether a row was updated.
export type SaveNotesAction = (
  notes: string,
) => Promise<{ updated: boolean; error?: string }>;

export interface EditNotesFormProps {
  // The current standing notes (customers.notes); '' when none.
  initialNotes: string;
  action: SaveNotesAction;
}

// Editable standing-notes block (gate code, "prefers texts", etc.). Distinct
// from AddNoteForm: this edits one persistent field rather than appending a
// timeline event. Save is enabled only when the text differs from what's saved.
export function EditNotesForm({ initialNotes, action }: EditNotesFormProps) {
  const [savedNotes, setSavedNotes] = useState(initialNotes);
  const [value, setValue] = useState(initialNotes);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = value !== savedNotes;

  const handleSave = () => {
    if (!dirty || pending) return;
    setError(null);
    setJustSaved(false);
    const next = value;
    startTransition(async () => {
      const res = await action(next);
      if (res.updated) {
        setSavedNotes(next);
        setJustSaved(true);
      } else {
        setError(res.error || "Couldn’t save notes.");
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label
          htmlFor="standing-notes"
          className="text-xs font-semibold uppercase tracking-wide text-ink/60"
        >
          Standing notes
        </label>
        {justSaved && !dirty && (
          <span className="text-xs text-emerald-700">Saved</span>
        )}
      </div>
      <textarea
        id="standing-notes"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setJustSaved(false);
        }}
        disabled={pending}
        rows={3}
        placeholder="Gate code, access notes, preferences — context that stays with this customer."
        className="block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40 disabled:opacity-60"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || pending}
          className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy hover:border-navy hover:bg-navy hover:text-white disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-navy"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    </div>
  );
}
