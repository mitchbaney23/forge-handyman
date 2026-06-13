"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { CustomerSummary } from "@/lib/data";

// Columns the table can sort by. `last` (last job date) is the default, newest
// first — mirroring listCustomers()' server-side order.
type SortKey = "name" | "jobs" | "properties" | "deposits" | "last";
type SortDir = "asc" | "desc";

export interface CustomerTableProps {
  customers: CustomerSummary[];
}

export function CustomerTable({ customers }: CustomerTableProps) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("last");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    // Search name / email / phone (Stage 14: phone is a search key). Phone is
    // matched on digits too so "5551234" finds "(555) 123-4...".
    const qDigits = q.replace(/\D/g, "");
    return customers.filter((c) => {
      const haystack = `${c.name} ${c.email} ${c.phone}`.toLowerCase();
      if (haystack.includes(q)) return true;
      if (qDigits && c.phone.replace(/\D/g, "").includes(qDigits)) return true;
      return false;
    });
  }, [customers, query]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const rows = [...filtered];
    rows.sort((a, b) => dir * compare(a, b, sortKey));
    return rows;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Text defaults A→Z; numbers/dates default high→low (most relevant first).
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, email, or phone…"
          className="block w-full max-w-sm rounded-lg border border-navy/15 bg-white px-3 py-2 text-sm focus:border-navy focus:outline-none focus:ring-2 focus:ring-amber-forge/40"
          aria-label="Search customers"
        />
        <span className="shrink-0 text-xs text-ink/50">
          {sorted.length} of {customers.length}
        </span>
      </div>

      {/* Desktop / wide: a real table. */}
      <div className="hidden overflow-hidden rounded-lg border border-navy/10 bg-white sm:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-navy/10 bg-cream/40 text-xs uppercase tracking-wide text-ink/55">
            <tr>
              <SortableTh
                label="Customer"
                active={sortKey === "name"}
                dir={sortDir}
                onClick={() => toggleSort("name")}
              />
              <th className="px-4 py-2.5 font-medium">Contact</th>
              <SortableTh
                label="Jobs"
                active={sortKey === "jobs"}
                dir={sortDir}
                onClick={() => toggleSort("jobs")}
                align="right"
              />
              <SortableTh
                label="Properties"
                active={sortKey === "properties"}
                dir={sortDir}
                onClick={() => toggleSort("properties")}
                align="right"
              />
              <SortableTh
                label="Deposits collected"
                active={sortKey === "deposits"}
                dir={sortDir}
                onClick={() => toggleSort("deposits")}
                align="right"
              />
              <SortableTh
                label="Last job"
                active={sortKey === "last"}
                dir={sortDir}
                onClick={() => toggleSort("last")}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-ink/55"
                >
                  No customers match “{query}”.
                </td>
              </tr>
            ) : (
              sorted.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-navy/5 last:border-0 hover:bg-cream/30"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/customers/${encodeURIComponent(c.id)}`}
                      className="font-medium text-navy hover:underline"
                    >
                      {displayName(c)}
                    </Link>
                    {c.anonymized && <AnonymizedTag />}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    <div className="truncate">{c.email || "—"}</div>
                    <div className="text-xs text-ink/50">{c.phone || ""}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink/70">
                    {c.jobCount || "0"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink/70">
                    {c.propertyCount || "0"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink/70">
                    {formatMoney(c.depositsCollectedCents)}
                  </td>
                  <td className="px-4 py-3 text-ink/70">
                    {formatDate(c.lastJobAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards. */}
      <div className="space-y-2 sm:hidden">
        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-navy/15 bg-white/50 p-6 text-center text-sm text-ink/55">
            No customers match “{query}”.
          </div>
        ) : (
          sorted.map((c) => (
            <Link
              key={c.id}
              href={`/admin/customers/${encodeURIComponent(c.id)}`}
              className="block rounded-lg border border-navy/10 bg-white p-4 shadow-sm transition-colors hover:border-navy/30"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-navy">
                    {displayName(c)}
                    {c.anonymized && <AnonymizedTag />}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink/60">
                    {c.email || "—"}
                    {c.phone ? ` · ${c.phone}` : ""}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-ink/50">
                  {formatDate(c.lastJobAt)}
                </span>
              </div>
              <div className="mt-2 flex gap-4 text-xs text-ink/55">
                <span>{c.jobCount || "0"} jobs</span>
                <span>{c.propertyCount || "0"} properties</span>
                <span>{formatMoney(c.depositsCollectedCents)} deposits</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-2.5 font-medium ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-navy ${
          active ? "text-navy" : ""
        }`}
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          {active ? (dir === "asc" ? "▲" : "▼") : ""}
        </span>
      </button>
    </th>
  );
}

function AnonymizedTag() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-stone-300 bg-stone-100 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-stone-600">
      Anonymized
    </span>
  );
}

// Comparators operate on the all-strings boundary: counts/cents are numeric
// strings, dates are ISO strings (lexicographically comparable), name is text.
function compare(a: CustomerSummary, b: CustomerSummary, key: SortKey): number {
  switch (key) {
    case "name":
      return displayName(a).localeCompare(displayName(b));
    case "jobs":
      return num(a.jobCount) - num(b.jobCount);
    case "properties":
      return num(a.propertyCount) - num(b.propertyCount);
    case "deposits":
      return num(a.depositsCollectedCents) - num(b.depositsCollectedCents);
    case "last":
      // ISO strings sort lexicographically; '' (no jobs) sorts to the bottom.
      return a.lastJobAt.localeCompare(b.lastJobAt);
  }
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function displayName(c: CustomerSummary): string {
  if (c.name) return c.name;
  if (c.anonymized) return "(anonymized customer)";
  return c.email || "(no name)";
}

function formatMoney(cents: string): string {
  const n = Number(cents);
  if (!Number.isFinite(n) || n === 0) return "$0";
  return `$${(n / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
