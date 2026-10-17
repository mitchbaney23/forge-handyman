"use client";

import { Field, inputClass } from "@/components/admin/JobFields";

// Date + start time + length for booking a job, shared by the customer page's
// New job form and the job page's Schedule panel. Eastern time; the server
// turns it into instants.

export interface ScheduleValue {
  date: string; // 'YYYY-MM-DD'
  startTime: string; // 'HH:MM'
  durationMinutes: number;
}

export const DEFAULT_SCHEDULE: ScheduleValue = { date: "", startTime: "09:00", durationMinutes: 120 };

const DURATIONS = [
  { minutes: 60, label: "1 hour" },
  { minutes: 90, label: "1½ hours" },
  { minutes: 120, label: "2 hours" },
  { minutes: 180, label: "3 hours" },
  { minutes: 240, label: "4 hours (half day)" },
  { minutes: 360, label: "6 hours" },
  { minutes: 480, label: "8 hours (full day)" },
];

export function ScheduleFields({
  value,
  onChange,
  calendarEmail,
  narrow = false,
}: {
  value: ScheduleValue;
  onChange: (next: ScheduleValue) => void;
  calendarEmail: string;
  // In a sidebar column: date on its own row, time + length beside each other.
  narrow?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className={narrow ? "grid grid-cols-2 gap-3" : "grid gap-4 sm:grid-cols-3"}>
        <div className={narrow ? "col-span-2" : undefined}>
          <Field label="Date" required>
            <input
              type="date"
              required
              value={value.date}
              onChange={(e) => onChange({ ...value, date: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>
        <Field label="Start time" required>
          <input
            type="time"
            required
            step={900}
            value={value.startTime}
            onChange={(e) => onChange({ ...value, startTime: e.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Length">
          <select
            value={value.durationMinutes}
            onChange={(e) => onChange({ ...value, durationMinutes: Number(e.target.value) })}
            className={inputClass}
          >
            {DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-xs text-ink/55">
        Eastern time. This adds the job to the Google Calendar for{" "}
        {calendarEmail}, sets it to Booked, and holds the time so the website
        won&rsquo;t book anyone else then. If the customer has an email on file they get the
        usual reminder the day before. David isn&rsquo;t messaged; dispatch him
        from the job page.
      </p>
    </div>
  );
}
