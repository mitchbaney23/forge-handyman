import { ContactDetails, type SaveContactAction } from "@/components/admin/EditContactForm";
import { EditNotesForm, type SaveNotesAction } from "@/components/admin/EditNotesForm";
import type { CustomerDetail } from "@/lib/data";

export interface CustomerHeaderProps {
  customer: CustomerDetail;
  // The standing-notes save action, colocated with the customer profile page
  // (built in a later stage) and threaded through to EditNotesForm. This
  // component never imports a page-level action directly.
  saveNotesAction: SaveNotesAction;
  // Name / phone / email edit, bound to this customer by the profile page.
  saveContactAction: SaveContactAction;
}

// The profile header: who the customer is (name + contact, editable) and a
// pinned, editable "Standing notes" block. Server-rendered; the contact and
// notes editors are the client islands inside it.
export function CustomerHeader({ customer, saveNotesAction, saveContactAction }: CustomerHeaderProps) {
  const name = customer.name || (customer.anonymized ? "(anonymized customer)" : "(no name)");

  return (
    <header className="rounded-lg border border-navy/10 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">Customer</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-semibold text-navy">
            {name}
            {customer.anonymized && (
              <span className="inline-flex items-center rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-stone-600">
                Anonymized
              </span>
            )}
          </h1>
          <ContactDetails
            name={customer.name}
            phone={customer.phone}
            email={customer.email}
            editable={!customer.anonymized}
            action={saveContactAction}
          />
        </div>

        <div className="flex shrink-0 gap-4 text-sm">
          <Stat label="Jobs" value={customer.jobCount || "0"} />
          <Stat label="Properties" value={customer.propertyCount || "0"} />
          <Stat label="Total spent" value={formatMoney(customer.totalSpentCents)} />
        </div>
      </div>

      {/* Pinned standing-notes block — distinct from the timeline note form. */}
      <div className="mt-5 border-t border-navy/10 pt-4">
        <EditNotesForm initialNotes={customer.notes} action={saveNotesAction} />
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="text-lg font-semibold text-navy tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wide text-ink/50">{label}</div>
    </div>
  );
}

function formatMoney(cents: string): string {
  const n = Number(cents);
  if (!Number.isFinite(n) || n === 0) return "$0";
  return `$${(n / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
