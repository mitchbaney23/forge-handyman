// Shared types for the Add Customer surface. Kept in a PLAIN module — NOT the
// "use server" actions file — because Turbopack treats every export of a
// "use server" module as a Server Action, so a type export there breaks the
// generated action proxy at build. Both the server action (actions.ts) and the
// client form (AddCustomerForm.tsx) import these from here.

// The shape the AddCustomerForm submits. `deal` is present only when the
// "also start a deal" toggle is on.
export interface CreateCustomerInput {
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  deal?: {
    serviceType: string;
    address?: string;
    description?: string;
    preferredDate?: string; // 'YYYY-MM-DD' or ''
    urgency?: string; // URGENCY_OPTIONS code or ''
  };
}

export type CreateCustomerActionResult =
  | { ok: true; customerId: string; jobId?: string; message: string }
  | { ok: false; error: string; duplicateId?: string };

// The profile page's Edit contact form. Every field is sent; the core writes
// only what differs. '' clears phone or email.
export interface UpdateContactInput {
  name: string;
  phone: string;
  email: string;
}

export type UpdateContactActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string; duplicateId?: string };

// The profile page's New job form. `schedule` is present only when "Schedule
// it now" is on: an Eastern date + start time and a length in minutes.
export interface NewJobFormInput {
  serviceType: string;
  address?: string;
  description?: string;
  preferredDate?: string; // 'YYYY-MM-DD' or ''; ignored when scheduled
  urgency?: string;
  schedule?: {
    date: string; // 'YYYY-MM-DD', Eastern
    startTime: string; // 'HH:MM', Eastern
    durationMinutes: number;
    emailCustomer: boolean;
  };
}

export type CreateJobActionResult =
  | { ok: true; jobId: string; scheduled: boolean; scheduleError?: string; message: string }
  | { ok: false; error: string };
