const STATUS_COLORS: Record<string, string> = {
  New: "bg-amber-100 text-amber-900 border-amber-300",
  Quoted: "bg-blue-100 text-blue-900 border-blue-300",
  "Pending Follow-Up": "bg-blue-100 text-blue-900 border-blue-300",
  Booked: "bg-emerald-100 text-emerald-900 border-emerald-300",
  "In Progress": "bg-violet-100 text-violet-900 border-violet-300",
  Complete: "bg-slate-100 text-slate-700 border-slate-300",
  Cancelled: "bg-stone-100 text-stone-600 border-stone-300",
  "Payment Failed": "bg-red-100 text-red-900 border-red-300",
  Refunded: "bg-orange-100 text-orange-900 border-orange-300",
  "Partial Refund": "bg-orange-100 text-orange-900 border-orange-300",
};

export function StatusBadge({ status }: { status: string }) {
  const tone =
    STATUS_COLORS[status] || "bg-slate-100 text-slate-700 border-slate-300";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {status || "—"}
    </span>
  );
}
