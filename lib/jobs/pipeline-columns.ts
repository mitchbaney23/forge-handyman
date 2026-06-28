// The pipeline board's column layout — a PURE module (no server/Next imports)
// so both the server page (app/admin/pipeline/page.tsx) and the client board
// (components/admin/PipelineBoard.tsx) import the exact same definition and can
// never drift. Lifted from the COLUMNS const that used to live inline in the
// page.
//
// `matches` are the job statuses that fall in the column. `dropStatus` is the
// status a card TAKES when dropped onto the column — the column's first concrete
// status (e.g. dropping on "Closed" sets "Cancelled"; the per-card move menu
// offers the granular siblings). `dropStatus: null` marks a column that is NOT
// a drop target: "Complete" must go through the job page's "Mark Complete" (it
// charges the saved-card balance), never a drag.

export interface PipelineColumnDef {
  status: string; // display label
  matches: string[]; // job statuses that render in this column
  staleAfterHours: number;
  dropStatus: string | null; // status applied on drop; null => not a drop target
}

export const PIPELINE_COLUMNS: PipelineColumnDef[] = [
  { status: "New", matches: ["New"], staleAfterHours: 24, dropStatus: "New" },
  {
    status: "Quoted",
    matches: ["Quoted", "Pending Follow-Up"],
    staleAfterHours: 7 * 24,
    dropStatus: "Quoted",
  },
  { status: "Booked", matches: ["Booked"], staleAfterHours: 14 * 24, dropStatus: "Booked" },
  {
    status: "In Progress",
    matches: ["In Progress"],
    staleAfterHours: 48,
    dropStatus: "In Progress",
  },
  // Complete is reachable only via markComplete / the Stripe webhook — never a
  // drop target (dropStatus: null), so a drag can't bypass the balance charge.
  { status: "Complete", matches: ["Complete"], staleAfterHours: 365 * 24, dropStatus: null },
  // Needs attention: a balance charge bounced — surface fast, don't drop it.
  {
    status: "Payment Failed",
    matches: ["Payment Failed"],
    staleAfterHours: 24,
    dropStatus: "Payment Failed",
  },
  // Closed out (cancelled or refunded) — visible, not silently dropped.
  {
    status: "Closed",
    matches: ["Cancelled", "Refunded", "Partial Refund"],
    staleAfterHours: 365 * 24,
    dropStatus: "Cancelled",
  },
];

// Index of the column a job with `status` renders in, or -1 if none matches.
export function columnIndexForStatus(status: string): number {
  return PIPELINE_COLUMNS.findIndex((c) => c.matches.includes(status));
}
