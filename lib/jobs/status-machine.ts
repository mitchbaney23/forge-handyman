// Admin (human) job-status transition rules — Stage 14 (Phase B2).
//
// The /admin status dropdown and updateJobStatus both enforce this. Two
// principles:
//   1. **'Complete' is never a dropdown target.** Completing a job goes through
//      markComplete (which charges the saved-card balance). Hand-setting
//      'Complete' from the dropdown would bypass that charge — the sharpest
//      edge in the pre-B2 admin. So 'Complete' is reachable only via
//      markComplete or the Stripe webhook, never this map.
//   2. **Generous escape edges** from every terminal/error state so a job set
//      to Payment Failed / Refunded / Cancelled by a webhook can always be
//      moved again — nothing wedges.
//
// Webhook-driven status writes (Booked / Complete / Payment Failed / Refunded)
// call updateRowByJobId DIRECTLY and intentionally bypass this guard — Stripe
// is the source of truth for payment-driven states.

export const ADMIN_STATUS_TRANSITIONS: Record<string, string[]> = {
  New: ["Quoted", "Pending Follow-Up", "Booked", "Cancelled"],
  Quoted: ["New", "Pending Follow-Up", "Booked", "Cancelled"],
  "Pending Follow-Up": ["New", "Quoted", "Booked", "Cancelled"],
  Booked: ["In Progress", "Pending Follow-Up", "Cancelled"],
  "In Progress": ["Booked", "Cancelled"],
  Complete: ["In Progress", "Refunded", "Partial Refund"],
  Cancelled: ["New", "Booked"],
  "Payment Failed": ["Booked", "In Progress", "Cancelled"],
  Refunded: ["Cancelled", "In Progress"],
  // No 'Complete' edge — Principle #1: 'Complete' is never a dropdown target
  // (it would skip markComplete's balance charge).
  "Partial Refund": ["Cancelled", "In Progress"],
};

// The statuses the dropdown should offer for a job currently in `from`: the
// current status itself (so the <select> value is valid) plus its allowed
// transitions, in a stable order.
export function statusOptionsFor(from: string): string[] {
  const allowed = ADMIN_STATUS_TRANSITIONS[from] ?? [];
  return [from, ...allowed.filter((s) => s !== from)];
}

// A human transition is permitted when it's a no-op (same status) or listed in
// the map for the current status.
export function canAdminTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return (ADMIN_STATUS_TRANSITIONS[from] ?? []).includes(to);
}
