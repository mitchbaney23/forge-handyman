// Activity vocabulary — the closed, versioned set of dotted-noun action
// strings the app writes to the audit log (sheet `Audit` tab / pg `activities`
// table), plus the actor-string helpers that prefix who did it.
//
// This is a TYPED VOCABULARY LAYER, not a DB constraint: the `action` and
// `actor` columns stay free-form `text`. Existing rows (and any future
// free-form actor strings) keep working — this module just gives call sites a
// single source of truth to import from so the timeline UI can map a known
// action to an icon/label, and Phase E's AI-as-actor slots in additively.
//
// EVERY string here is one currently produced by an `appendAuditRow` caller
// (grep `action:` across the repo), with two deliberate additions:
//   - `note.added`            — the new B1 timeline note (addJobNote)
//   - `nudge.sent`/`nudge.skipped` — the renamed/split seasonal-nudge actions
// The legacy `seasonal_nudge.sent`/`seasonal_nudge.skipped` strings are kept
// too so historical rows and the unconverted seasonal-nudges caller still
// resolve to a known action.

// ---------------------------------------------------------------------------
// Actions — the closed set, grouped by surface.
// ---------------------------------------------------------------------------

export const ACTIONS = {
  // Job lifecycle (admin job actions + Stripe webhook)
  JOB_BOOKED: 'job.booked',
  JOB_STATUS_CHANGED: 'job.status_changed',

  // Scheduling (Phase C self-scheduling)
  APPOINTMENT_SCHEDULED: 'appointment.scheduled',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',
  JOB_COMPLETED: 'job.completed',
  JOB_FIRST_TOUCH_RECORDED: 'job.first_touch_recorded',

  // Quotes (admin quote actions)
  QUOTE_SENT: 'quote.sent',

  // Payments / Stripe money path
  PAYMENT_LINK_CREATED: 'payment_link.created',
  PAYMENT_DEPOSIT_SUCCEEDED: 'payment.deposit.succeeded',
  PAYMENT_BALANCE_CHARGE_SUCCEEDED: 'payment.balance-charge.succeeded',
  PAYMENT_FAILED: 'payment.failed',
  BALANCE_CHARGED: 'balance.charged',
  BALANCE_CHARGE_FAILED: 'balance.charge_failed',
  REFUND_ISSUED: 'refund.issued',
  REFUND_FAILED: 'refund.failed',
  CHARGE_FULLY_REFUNDED: 'charge.fully_refunded',
  CHARGE_PARTIALLY_REFUNDED: 'charge.partially_refunded',

  // Customer (Stripe webhook)
  CUSTOMER_CREATED: 'customer.created',

  // Dispatch (admin + Telegram webhook)
  DISPATCH_SENT: 'dispatch.sent',
  DISPATCH_APPROVED: 'dispatch.approved',
  DISPATCH_DECLINED: 'dispatch.declined',
  DISPATCH_NEEDS_SUB: 'dispatch.needs_sub',

  // Notes — NEW in B1 (timeline event note)
  NOTE_ADDED: 'note.added',

  // Seasonal nudges. NEW canonical names (nudge.*) plus the legacy
  // seasonal_nudge.* strings the current caller still writes and historical
  // rows carry.
  NUDGE_SENT: 'nudge.sent',
  NUDGE_SKIPPED: 'nudge.skipped',
  SEASONAL_NUDGE_SENT: 'seasonal_nudge.sent',
  SEASONAL_NUDGE_SKIPPED: 'seasonal_nudge.skipped',

  // Privacy / data requests
  DATA_ANONYMIZED: 'data.anonymized',

  // Sheet migration / setup
  SHEET_MIGRATION_APPLIED: 'sheet.migration_applied',
  SHEET_MIGRATION_NOOP: 'sheet.migration_noop',
} as const

// The union of every known action string. Free-form actions from legacy rows
// won't satisfy this type, but they are never rejected at runtime — the column
// stays text and the timeline falls back to a generic rendering for unknowns.
export type ActivityAction = (typeof ACTIONS)[keyof typeof ACTIONS]

// ---------------------------------------------------------------------------
// Actors — who performed the action. The column is free-form text; these are
// the canonical constructors/constants so call sites stop hand-rolling
// prefixes. `admin:<email>` and `telegram:<who>` are namespaced; the
// non-human actors are bare tokens.
// ---------------------------------------------------------------------------

export const ACTORS = {
  CLAUDE: 'claude',
  SYSTEM: 'system',
  STRIPE_WEBHOOK: 'stripe-webhook',
  adminActor: (email: string): string => `admin:${email}`,
  telegramActor: (who: string): string => `telegram:${who}`,
} as const

// Re-export the non-namespaced constants at top level for ergonomic imports
// (matches how call sites already pass bare 'stripe-webhook' / 'claude').
export const CLAUDE = ACTORS.CLAUDE
export const SYSTEM = ACTORS.SYSTEM
export const STRIPE_WEBHOOK = ACTORS.STRIPE_WEBHOOK
export const adminActor = ACTORS.adminActor
export const telegramActor = ACTORS.telegramActor

// The known actor shapes. Like ActivityAction this is a vocabulary type, not a
// runtime constraint — `admin:<email>` and `telegram:<who>` widen to string.
export type ActorType =
  | typeof ACTORS.CLAUDE
  | typeof ACTORS.SYSTEM
  | typeof ACTORS.STRIPE_WEBHOOK
  | `admin:${string}`
  | `telegram:${string}`
