import { formatCents, type QuoteLine } from "@/lib/quote-lines";

// The priced lines of a menu quote as a compact table: the quote composer's
// live preview and the job page's record of what was quoted.
export function QuoteLinesTable({
  lines,
  totalCents,
}: {
  lines: QuoteLine[];
  totalCents: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-ink/55">
            <th className="pb-1 font-semibold">Item</th>
            <th className="px-1 pb-1 text-center font-semibold">Qty</th>
            <th className="pb-1 pl-2 text-right font-semibold">Price</th>
            <th className="pb-1 pl-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => (
            <tr key={`${line.id}-${idx}`} className="border-t border-navy/10 align-top">
              <td className="py-1.5 pr-2 text-ink">
                {line.name}
                {line.addOn && (
                  <span className="mt-0.5 block w-fit whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
                    Add-on price
                  </span>
                )}
              </td>
              <td className="px-1 py-1.5 text-center tabular-nums text-ink/80">{line.qty}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-ink/80">
                {formatCents(line.unitCents)}
              </td>
              <td className="py-1.5 pl-2 text-right font-medium tabular-nums text-navy">
                {formatCents(line.totalCents)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-navy/30">
            <td colSpan={3} className="pt-2 font-semibold text-navy">
              Total
            </td>
            <td className="pt-2 text-right text-base font-semibold tabular-nums text-navy">
              {formatCents(totalCents)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
