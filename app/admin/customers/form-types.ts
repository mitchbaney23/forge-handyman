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
