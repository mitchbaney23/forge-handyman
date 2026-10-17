"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { sendQuote, type SendQuoteResult } from "./actions";
import { QuoteLinesTable } from "@/components/admin/QuoteLinesTable";
import type { Cart, CartSelection } from "@/lib/cart";
import { SERVICE_MENU } from "@/lib/constants";
import { FAMILY_DISCOUNT_LABEL } from "@/lib/family-pricing";
import {
  MIN_DEPOSIT_CENTS,
  QUOTABLE_PACKAGES,
  QUOTE_MAX_LINES,
  QUOTE_MAX_QTY,
  formatCents,
  itemizeQuote,
} from "@/lib/quote-lines";

const TIER_OPTIONS = [
  { value: "small" as const, label: "Small — half-day or less" },
  { value: "medium" as const, label: "Medium — full day" },
  { value: "large" as const, label: "Large — multi-day" },
];

// Where the menu builder's starting items came from.
export type MenuPrefill = {
  cart: Cart;
  source: "last-quote" | "booking";
  // ISO time of the last quote, for source "last-quote".
  sentAt: string;
  // Booked item names the current menu no longer has.
  unmatched: string[];
};

const MENU_ITEM_NAME = new Map(
  SERVICE_MENU.flatMap((s) => s.items.map((i) => [i.id, i.name] as const)),
);

const inputClass =
  "block w-full rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40";
const labelClass =
  "mb-1 block text-xs font-semibold uppercase tracking-wide text-ink/60";

export function QuoteComposer({
  jobId,
  customerName,
  customerEmail,
  serviceType,
  initialDescription,
  prefillDepositDollars,
  bookedEstimateCents,
  menuPrefill,
  family,
}: {
  jobId: string;
  customerName: string;
  customerEmail: string;
  serviceType: string;
  initialDescription: string;
  // For self-scheduled jobs: the price the customer already selected, pre-filled
  // as the deposit so the quote is a review-and-send. Undefined for custom jobs.
  prefillDepositDollars?: number;
  bookedEstimateCents: number | null;
  menuPrefill: MenuPrefill | null;
  // Forge Family job: menu lines price at the family rate.
  family: boolean;
}) {
  const [mode, setMode] = useState<"menu" | "custom">(
    menuPrefill ? "menu" : "custom",
  );
  const [tier, setTier] = useState<"small" | "medium" | "large">("medium");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SendQuoteResult | null>(null);

  // Custom amount.
  const [deposit, setDeposit] = useState(
    prefillDepositDollars ? String(prefillDepositDollars) : "",
  );
  const [balance, setBalance] = useState(prefillDepositDollars ? "0" : "");
  const [description, setDescription] = useState(initialDescription);

  // From the menu.
  const [items, setItems] = useState<CartSelection[]>(
    menuPrefill?.cart.items ?? [],
  );
  const [packageNumber, setPackageNumber] = useState<number | null>(
    menuPrefill?.cart.packageNumber ?? null,
  );
  const [collectFull, setCollectFull] = useState(true);
  const [menuDeposit, setMenuDeposit] = useState("");
  const [menuNote, setMenuNote] = useState("");

  const quote = useMemo(
    () => itemizeQuote({ items, packageNumber }, { family }),
    [items, packageNumber, family],
  );
  const menuDepositCents = collectFull
    ? quote.totalCents
    : Math.round((parseFloat(menuDeposit) || 0) * 100);
  const menuBalanceCents = quote.totalCents - menuDepositCents;
  const menuDepositError =
    quote.lines.length === 0
      ? null
      : menuDepositCents < MIN_DEPOSIT_CENTS
        ? "Deposit must be at least $1.00"
        : menuDepositCents > quote.totalCents
          ? `Deposit can't be more than the ${formatCents(quote.totalCents)} total`
          : null;

  const depositNum = parseFloat(deposit) || 0;
  const balanceNum = parseFloat(balance) || 0;
  const total = depositNum + balanceNum;

  const addFromMenu = (value: string) => {
    if (value.startsWith("pkg:")) {
      setPackageNumber(Number(value.slice(4)));
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
        i.id === id
          ? { ...i, qty: Math.max(1, Math.min(qty, QUOTE_MAX_QTY)) }
          : i,
      ),
    );

  const removeItem = (id: string) =>
    setItems((current) => current.filter((i) => i.id !== id));

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res =
        mode === "menu"
          ? await sendQuote({
              mode: "menu",
              jobId,
              tier,
              menu: { items, packageNumber },
              depositDollars: collectFull ? undefined : menuDepositCents / 100,
              expectedTotalCents: quote.totalCents,
              descriptionOverride: menuNote,
            })
          : await sendQuote({
              mode: "custom",
              jobId,
              tier,
              depositDollars: depositNum,
              balanceDollars: balanceNum,
              descriptionOverride: description,
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
    mode === "menu"
      ? quote.lines.length > 0 && !menuDepositError
      : Boolean(deposit && balance);

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

      <div
        role="group"
        aria-label="How to price this quote"
        className="grid grid-cols-2 gap-1 rounded-lg border border-navy/15 bg-navy/[0.03] p-1"
      >
        {(
          [
            ["menu", "From the menu"],
            ["custom", "Custom amount"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => {
              setMode(value);
              setResult(null);
            }}
            className={`rounded-md px-3 py-2 text-sm font-medium ${
              mode === value
                ? "bg-navy text-white shadow-sm"
                : "text-navy hover:bg-navy/10"
            }`}
          >
            {label}
          </button>
        ))}
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

      {mode === "menu" ? (
        <>
          {menuPrefill?.source === "last-quote" && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Pre-filled from the quote sent{" "}
              {new Date(menuPrefill.sentAt).toLocaleDateString()}.
            </p>
          )}
          {menuPrefill?.source === "booking" && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Pre-filled with the items they picked at booking. Adjust anything
              before sending.
            </p>
          )}
          {menuPrefill && menuPrefill.unmatched.length > 0 && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-900">
              Not on the current menu, so not added:{" "}
              {menuPrefill.unmatched.join(", ")}. Add a replacement or use a
              custom amount.
            </p>
          )}
          {family && (
            <p className="rounded-md border border-amber-forge/40 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              Forge Family job: every line prices at {FAMILY_DISCOUNT_LABEL} off
              the menu.
            </p>
          )}

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
                    #{pkg.number} {pkg.name} — {pkg.price} · up to{" "}
                    {pkg.itemCount} small fixes
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
            <p className="mt-1 text-xs text-ink/55">
              The #3 Whole List is priced from photos. Send it as a custom
              amount.
            </p>
          </div>

          {(items.length > 0 || packageNumber != null) && (
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
                    <span
                      className="w-8 text-center tabular-nums"
                      aria-label="Quantity"
                    >
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
            </ul>
          )}

          {quote.lines.length > 0 ? (
            <div className="rounded-lg border border-navy/10 bg-navy/5 px-3 py-3 sm:px-4">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                What the customer sees
              </div>
              <QuoteLinesTable lines={quote.lines} totalCents={quote.totalCents} />
              <p className="mt-2 text-xs text-ink/55">
                The highest-priced item is full price for one unit; every other
                unit is its add-on price. $200+ items are always full price.
                {family ? ` Forge Family: ${FAMILY_DISCOUNT_LABEL} off each price.` : ""}
              </p>
              {menuPrefill?.source === "booking" &&
                bookedEstimateCents != null &&
                bookedEstimateCents !== quote.totalCents && (
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    They saw {formatCents(bookedEstimateCents)} at booking; this
                    quote totals {formatCents(quote.totalCents)}.
                  </p>
                )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-navy/20 px-4 py-6 text-center text-sm text-ink/55">
              Add items from the menu to build the quote.
            </p>
          )}

          {quote.lines.length > 0 && (
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
                    <label htmlFor="menu-deposit" className={labelClass}>
                      Deposit (USD)
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
                        $
                      </span>
                      <input
                        id="menu-deposit"
                        type="number"
                        step="0.01"
                        min="1"
                        max={quote.totalCents / 100}
                        required
                        value={menuDeposit}
                        onChange={(e) => setMenuDeposit(e.target.value)}
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
                      {menuBalanceCents >= 0 ? formatCents(menuBalanceCents) : "—"}
                    </p>
                    <p className="mt-1 text-xs text-ink/55">
                      Auto-charged when you Mark Complete.
                    </p>
                  </div>
                </div>
              )}
              {menuDepositError && menuDeposit !== "" && (
                <p className="text-xs text-red-700">{menuDepositError}</p>
              )}
            </div>
          )}

          <div>
            <label htmlFor="menu-note" className={labelClass}>
              Note above the items (optional, shown to the customer)
            </label>
            <textarea
              id="menu-note"
              rows={3}
              value={menuNote}
              onChange={(e) => setMenuNote(e.target.value)}
              maxLength={500}
              placeholder="Scope, access, or materials — e.g. customer supplies the fixtures."
              className={inputClass}
            />
            <p className="mt-1 text-xs text-ink/55">
              {menuNote.length}/500 characters
            </p>
          </div>
        </>
      ) : (
        <>
          {prefillDepositDollars ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Pre-filled with the ${prefillDepositDollars} they selected at booking
              — review and adjust the deposit/balance split if you like.
            </p>
          ) : null}

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
                  required
                  value={deposit}
                  onChange={(e) => setDeposit(e.target.value)}
                  className={`${inputClass} pl-7`}
                  placeholder="150.00"
                />
              </div>
              <p className="mt-1 text-xs text-ink/55">
                Charged now to book the date and save card on file.
              </p>
            </div>
            <div>
              <label htmlFor="balance" className={labelClass}>
                Balance (USD)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink/50">
                  $
                </span>
                <input
                  id="balance"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={balance}
                  onChange={(e) => setBalance(e.target.value)}
                  className={`${inputClass} pl-7`}
                  placeholder="350.00"
                />
              </div>
              <p className="mt-1 text-xs text-ink/55">
                Auto-charged when you Mark Complete.
              </p>
            </div>
          </div>

          {total > 0 && (
            <div className="rounded-lg border border-navy/10 bg-navy/5 px-4 py-3 text-sm">
              <div className="flex items-baseline justify-between">
                <span className="text-ink/70">Total estimate</span>
                <span className="text-lg font-semibold text-navy">
                  ${total.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <div>
            <label htmlFor="description" className={labelClass}>
              Description (shown to customer in the email)
            </label>
            <textarea
              id="description"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-ink/55">
              {description.length}/500 characters
            </p>
          </div>
        </>
      )}

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
