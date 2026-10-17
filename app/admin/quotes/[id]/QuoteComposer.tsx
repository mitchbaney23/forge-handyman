"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { sendQuote, type SendQuoteResult } from "./actions";
import { QuoteLinesTable } from "@/components/admin/QuoteLinesTable";
import type { Cart, CartSelection } from "@/lib/cart";
import { SERVICE_MENU, SERVICE_PACKAGES } from "@/lib/constants";
import { FAMILY_DISCOUNT_LABEL } from "@/lib/family-pricing";
import {
  CUSTOM_MAX_QTY,
  CUSTOM_MAX_UNIT_CENTS,
  CUSTOM_NAME_MAX,
  MIN_DEPOSIT_CENTS,
  QUOTABLE_PACKAGES,
  QUOTE_MAX_CUSTOM_LINES,
  QUOTE_MAX_LINES,
  QUOTE_MAX_QTY,
  formatCents,
  itemizeQuote,
  type CustomLineInput,
} from "@/lib/quote-lines";

const TIER_OPTIONS = [
  { value: "small" as const, label: "Small — half-day or less" },
  { value: "medium" as const, label: "Medium — full day" },
  { value: "large" as const, label: "Large — multi-day" },
];

// One-tap starts for the lines that come up most; the name stays editable.
const CUSTOM_PRESETS = [
  { name: "Travel fee", price: "" },
  { name: "Materials", price: "" },
  { name: "Disposal / dump run", price: "" },
  { name: "Discount", price: "-" },
];

// Bundles priced from photos (the #3) go on as a custom line to price by hand.
const QUOTE_FIRST_PACKAGES = SERVICE_PACKAGES.filter((p) => p.quoteFirst);

// Where the builder's starting lines came from.
export type QuotePrefill = {
  cart: Cart;
  // Custom lines to start with. unitCents null = name known, price to fill in
  // (a booked item the menu no longer has).
  custom: { name: string; qty: number; unitCents: number | null }[];
  source: "last-quote" | "booking";
  // ISO time of the last quote, for source "last-quote".
  sentAt: string;
};

const MENU_ITEM_NAME = new Map(
  SERVICE_MENU.flatMap((s) => s.items.map((i) => [i.id, i.name] as const)),
);

const inputClass =
  "block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40";
const labelClass =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60";

// A custom line as typed: strings until it parses.
type CustomRow = { key: number; name: string; qty: string; price: string };

type ParsedRow = { ok: true; line: CustomLineInput } | { ok: false; error: string };

function parseRow(row: CustomRow): ParsedRow {
  const name = row.name.trim();
  if (!name) return { ok: false, error: "Give it a name the customer will see." };
  const qty = Number(row.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > CUSTOM_MAX_QTY) {
    return { ok: false, error: `Quantity is a whole number from 1 to ${CUSTOM_MAX_QTY}.` };
  }
  const price = row.price.trim();
  if (price === "" || price === "-") return { ok: false, error: "Enter a price." };
  const dollars = Number(price);
  if (!Number.isFinite(dollars)) return { ok: false, error: "Enter a price like 45 or 45.50." };
  const unitCents = Math.round(dollars * 100);
  if (Math.abs(unitCents) > CUSTOM_MAX_UNIT_CENTS) {
    return { ok: false, error: `A price can't be more than ${formatCents(CUSTOM_MAX_UNIT_CENTS)}.` };
  }
  return { ok: true, line: { name, qty, unitCents } };
}

export function QuoteComposer({
  jobId,
  customerName,
  customerEmail,
  serviceType,
  bookedEstimateCents,
  prefill,
  family,
}: {
  jobId: string;
  customerName: string;
  customerEmail: string;
  serviceType: string;
  bookedEstimateCents: number | null;
  prefill: QuotePrefill | null;
  // Forge Family job: menu lines price at the family rate.
  family: boolean;
}) {
  const [tier, setTier] = useState<"small" | "medium" | "large">("medium");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SendQuoteResult | null>(null);

  const [items, setItems] = useState<CartSelection[]>(prefill?.cart.items ?? []);
  const [packageNumber, setPackageNumber] = useState<number | null>(
    prefill?.cart.packageNumber ?? null,
  );
  const [nextKey, setNextKey] = useState((prefill?.custom.length ?? 0) + 1);
  const [customRows, setCustomRows] = useState<CustomRow[]>(
    (prefill?.custom ?? []).map((c, i) => ({
      key: i + 1,
      name: c.name,
      qty: String(c.qty),
      price: c.unitCents == null ? "" : (c.unitCents / 100).toFixed(2),
    })),
  );
  const [collectFull, setCollectFull] = useState(true);
  const [depositInput, setDepositInput] = useState("");
  const [note, setNote] = useState("");

  const parsedRows = customRows.map(parseRow);
  const validCustom = parsedRows.flatMap((r) => (r.ok ? [r.line] : []));
  const rowsInvalid = parsedRows.some((r) => !r.ok);

  const quote = itemizeQuote({ items, packageNumber }, { family, custom: validCustom });
  const hasMenuLines = items.length > 0 || packageNumber != null;
  const hasAnyLine = hasMenuLines || customRows.length > 0;

  const depositCents = collectFull
    ? quote.totalCents
    : Math.round((parseFloat(depositInput) || 0) * 100);
  const balanceCents = quote.totalCents - depositCents;
  const totalError =
    hasAnyLine && !rowsInvalid && quote.totalCents < MIN_DEPOSIT_CENTS
      ? `The total is ${formatCents(quote.totalCents)}; a quote needs at least $1.00.`
      : null;
  const depositError =
    collectFull || quote.totalCents < MIN_DEPOSIT_CENTS
      ? null
      : depositCents < MIN_DEPOSIT_CENTS
        ? "Deposit must be at least $1.00"
        : depositCents > quote.totalCents
          ? `Deposit can't be more than the ${formatCents(quote.totalCents)} total`
          : null;

  const addFromMenu = (value: string) => {
    if (value.startsWith("pkg:")) {
      setPackageNumber(Number(value.slice(4)));
      return;
    }
    if (value.startsWith("byhand:")) {
      const pkg = QUOTE_FIRST_PACKAGES.find((p) => p.number === Number(value.slice(7)));
      if (pkg) addCustom(`#${pkg.number} ${pkg.name}`, "");
      return;
    }
    const id = value.slice("item:".length);
    setItems((current) => {
      const existing = current.find((i) => i.id === id);
      if (existing) {
        return current.map((i) =>
          i.id === id ? { ...i, qty: Math.min(i.qty + 1, QUOTE_MAX_QTY) } : i,
        );
      }
      if (current.length >= QUOTE_MAX_LINES) return current;
      return [...current, { id, qty: 1 }];
    });
  };

  const setQty = (id: string, qty: number) =>
    setItems((current) =>
      current.map((i) =>
        i.id === id ? { ...i, qty: Math.max(1, Math.min(qty, QUOTE_MAX_QTY)) } : i,
      ),
    );

  const removeItem = (id: string) =>
    setItems((current) => current.filter((i) => i.id !== id));

  function addCustom(name = "", price = "") {
    if (customRows.length >= QUOTE_MAX_CUSTOM_LINES) return;
    setCustomRows((rows) => [...rows, { key: nextKey, name, qty: "1", price }]);
    setNextKey((k) => k + 1);
  }

  const updateCustom = (key: number, patch: Partial<CustomRow>) =>
    setCustomRows((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const removeCustom = (key: number) =>
    setCustomRows((rows) => rows.filter((r) => r.key !== key));

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await sendQuote({
        jobId,
        tier,
        menu: { items, packageNumber },
        customLines: validCustom,
        depositDollars: collectFull ? undefined : depositCents / 100,
        expectedTotalCents: quote.totalCents,
        descriptionOverride: note,
      });
      setResult(res);
    });
  };

  if (result?.ok) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 className="text-lg font-semibold text-emerald-900">Quote sent ✓</h2>
        <p className="mt-2 text-sm text-emerald-900/85">
          Email is on its way to {customerEmail}. The payment link expires on{" "}
          {new Date(result.expiresAt).toLocaleDateString()}.
        </p>
        <div className="mt-4 rounded-lg bg-white/60 p-3">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-emerald-900/70">
            Payment Link (for your records)
          </div>
          <a
            href={result.paymentLinkUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sm font-mono text-emerald-800 underline hover:no-underline"
          >
            {result.paymentLinkUrl}
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href={`/admin/jobs/${jobId}`} className="btn-primary">
            Back to job
          </Link>
          <Link
            href="/admin"
            className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
          >
            Back to overview
          </Link>
        </div>
      </div>
    );
  }

  const canSend =
    hasAnyLine && !rowsInvalid && !totalError && !depositError && quote.lines.length > 0;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-5 rounded-xl border border-navy/10 bg-white p-6 shadow-card"
    >
      <div>
        <h2 className="text-lg font-semibold text-navy">Compose quote</h2>
        <p className="mt-1 text-sm text-ink/60">
          Sending to <span className="font-medium text-ink">{customerName}</span>{" "}
          at <span className="font-medium text-ink">{customerEmail}</span> for{" "}
          <span className="font-medium text-ink">{serviceType}</span>.
        </p>
      </div>

      <div>
        <label htmlFor="tier" className={labelClass}>
          Job tier
        </label>
        <select
          id="tier"
          value={tier}
          onChange={(e) => setTier(e.target.value as "small" | "medium" | "large")}
          className={inputClass}
        >
          {TIER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {prefill?.source === "last-quote" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Pre-filled from the quote sent {new Date(prefill.sentAt).toLocaleDateString()}.
        </p>
      )}
      {prefill?.source === "booking" && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Pre-filled with what they picked at booking. Change anything before
          sending.
          {prefill.custom.some((c) => c.unitCents == null)
            ? " Items no longer on the menu are added as your own lines; give them a price."
            : ""}
        </p>
      )}
      {family && (
        <p className="rounded-md border border-amber-forge/40 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
          Forge Family job: menu items price at {FAMILY_DISCOUNT_LABEL} off. Your
          own lines are charged as you enter them.
        </p>
      )}

      <div className="space-y-3">
        <div>
          <label htmlFor="menu-add" className={labelClass}>
            Add from the menu
          </label>
          <select
            id="menu-add"
            value=""
            onChange={(e) => {
              if (e.target.value) addFromMenu(e.target.value);
            }}
            className={inputClass}
          >
            <option value="">Choose an item or bundle…</option>
            <optgroup label="Bundles">
              {QUOTABLE_PACKAGES.map((pkg) => (
                <option key={pkg.number} value={`pkg:${pkg.number}`}>
                  #{pkg.number} {pkg.name} — {pkg.price} · up to {pkg.itemCount} small
                  fixes
                </option>
              ))}
              {QUOTE_FIRST_PACKAGES.map((pkg) => (
                <option key={pkg.number} value={`byhand:${pkg.number}`}>
                  #{pkg.number} {pkg.name} — you set the price
                </option>
              ))}
            </optgroup>
            {SERVICE_MENU.map((section) => (
              <optgroup key={section.category} label={section.category}>
                {section.items.map((item) => (
                  <option key={item.id} value={`item:${item.id}`}>
                    {item.name} — {item.price}
                    {item.addOnPrice && item.addOnCents! < item.priceCents
                      ? ` · add-on ${item.addOnPrice}`
                      : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <span className={labelClass}>Add your own line</span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => addCustom()}
              disabled={customRows.length >= QUOTE_MAX_CUSTOM_LINES}
              className="rounded-lg border border-navy/20 bg-white px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy hover:text-white disabled:opacity-40"
            >
              + Custom line
            </button>
            {CUSTOM_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => addCustom(preset.name, preset.price)}
                disabled={customRows.length >= QUOTE_MAX_CUSTOM_LINES}
                className="rounded-lg border border-navy/10 bg-navy/[0.03] px-3 py-1.5 text-sm text-navy hover:border-navy/30 disabled:opacity-40"
              >
                + {preset.name}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink/55">
            Charged exactly as you enter them. Use a negative price for a
            discount or credit, or $0 for something included.
          </p>
        </div>
      </div>

      {hasAnyLine && (
        <ul className="divide-y divide-navy/10 rounded-lg border border-navy/10">
          {packageNumber != null && (
            <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="font-medium text-ink">
                {quote.lines.find((l) => l.kind === "package")?.name}
              </span>
              <button
                type="button"
                onClick={() => setPackageNumber(null)}
                className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                Remove
              </button>
            </li>
          )}
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 font-medium text-ink">
                {MENU_ITEM_NAME.get(item.id) ?? item.id}
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`One fewer ${MENU_ITEM_NAME.get(item.id)}`}
                  disabled={item.qty <= 1}
                  onClick={() => setQty(item.id, item.qty - 1)}
                  className="h-8 w-8 rounded-md border border-navy/15 text-navy hover:bg-navy/5 disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-8 text-center tabular-nums" aria-label="Quantity">
                  {item.qty}
                </span>
                <button
                  type="button"
                  aria-label={`One more ${MENU_ITEM_NAME.get(item.id)}`}
                  disabled={item.qty >= QUOTE_MAX_QTY}
                  onClick={() => setQty(item.id, item.qty + 1)}
                  className="h-8 w-8 rounded-md border border-navy/15 text-navy hover:bg-navy/5 disabled:opacity-40"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  className="ml-1 rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
          {customRows.map((row, index) => {
            const parsed = parsedRows[index];
            const touched = row.name !== "" || (row.price !== "" && row.price !== "-");
            return (
              <li key={row.key} className="space-y-2 px-3 py-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/50">
                    Your line
                  </span>
                  <button
                    type="button"
                    onClick={() => removeCustom(row.key)}
                    className="rounded-md px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
                <div className="grid grid-cols-[1fr_5rem_7.5rem] gap-2 max-sm:grid-cols-2">
                  <input
                    type="text"
                    aria-label="Line name"
                    value={row.name}
                    maxLength={CUSTOM_NAME_MAX}
                    onChange={(e) => updateCustom(row.key, { name: e.target.value })}
                    placeholder="What it is, e.g. Travel fee (Benson)"
                    className={`${inputClass} max-sm:col-span-2`}
                  />
                  <input
                    type="number"
                    aria-label="Quantity"
                    inputMode="numeric"
                    min={1}
                    max={CUSTOM_MAX_QTY}
                    step={1}
                    value={row.qty}
                    onChange={(e) => updateCustom(row.key, { qty: e.target.value })}
                    className={inputClass}
                  />
                  <div className="relative">
                    <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
                      $
                    </span>
                    <input
                      type="text"
                      aria-label="Price each"
                      inputMode="decimal"
                      value={row.price}
                      onChange={(e) => updateCustom(row.key, { price: e.target.value })}
                      placeholder="0.00"
                      className={`${inputClass} pl-7`}
                    />
                  </div>
                </div>
                {!parsed.ok && touched && (
                  <p className="text-xs text-red-700">{parsed.error}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {quote.lines.length > 0 ? (
        <div className="rounded-lg border border-navy/10 bg-navy/5 px-3 py-3 sm:px-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
            What the customer sees
          </div>
          <QuoteLinesTable lines={quote.lines} totalCents={quote.totalCents} />
          {hasMenuLines && (
            <p className="mt-2 text-xs text-ink/55">
              Menu items: the highest-priced item is full price for one unit;
              every other unit is its add-on price. $200+ items are always full
              price.
              {family ? ` Forge Family: ${FAMILY_DISCOUNT_LABEL} off each menu price.` : ""}
            </p>
          )}
          {prefill?.source === "booking" &&
            bookedEstimateCents != null &&
            bookedEstimateCents !== quote.totalCents && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                They saw {formatCents(bookedEstimateCents)} at booking; this quote
                totals {formatCents(quote.totalCents)}.
              </p>
            )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-navy/20 px-4 py-6 text-center text-sm text-ink/55">
          Add menu items or your own lines to build the quote.
        </p>
      )}

      {totalError && <p className="text-xs text-red-700">{totalError}</p>}

      {quote.totalCents >= MIN_DEPOSIT_CENTS && (
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={collectFull}
              onChange={(e) => setCollectFull(e.target.checked)}
              className="h-4 w-4 rounded border-navy/30"
            />
            Collect the full {formatCents(quote.totalCents)} now
          </label>
          {!collectFull && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="deposit" className={labelClass}>
                  Deposit (USD)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
                    $
                  </span>
                  <input
                    id="deposit"
                    type="number"
                    step="0.01"
                    min="1"
                    max={quote.totalCents / 100}
                    required
                    value={depositInput}
                    onChange={(e) => setDepositInput(e.target.value)}
                    className={`${inputClass} pl-7`}
                    placeholder="100.00"
                  />
                </div>
                <p className="mt-1 text-xs text-ink/55">
                  Charged now to book the date and save card on file.
                </p>
              </div>
              <div>
                <span className={labelClass}>Balance at completion</span>
                <p className="py-2 text-sm font-semibold text-navy">
                  {balanceCents >= 0 ? formatCents(balanceCents) : "—"}
                </p>
                <p className="mt-1 text-xs text-ink/55">
                  Auto-charged when you Mark Complete.
                </p>
              </div>
            </div>
          )}
          {depositError && depositInput !== "" && (
            <p className="text-xs text-red-700">{depositError}</p>
          )}
        </div>
      )}

      <div>
        <label htmlFor="note" className={labelClass}>
          Note above the lines (optional, shown to the customer)
        </label>
        <textarea
          id="note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Scope, access, or materials — e.g. customer supplies the fixtures."
          className={inputClass}
        />
        <p className="mt-1 text-xs text-ink/55">{note.length}/500 characters</p>
      </div>

      {result && !result.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {result.error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending || !canSend} className="btn-primary">
          {pending ? "Sending…" : "Create & Send Quote"}
        </button>
        <Link
          href={`/admin/jobs/${jobId}`}
          className="rounded-lg border border-navy/15 bg-white px-4 py-2 text-sm font-medium text-navy hover:border-navy hover:bg-navy hover:text-white"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
