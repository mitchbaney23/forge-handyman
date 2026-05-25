import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JobActions } from "./JobActions";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { findRowByJobId } from "@/lib/sheet/repo";

export const metadata: Metadata = {
  title: "Job — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const found = await findRowByJobId(decoded);
  if (!found) notFound();
  const { row } = found;

  const balanceCents = Number(row.balance_owed_cents || "0");
  const depositCents = Number(row.deposit_paid_cents || "0");

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin"
          className="text-xs font-medium text-ink/60 hover:text-navy"
        >
          ← Back to overview
        </Link>
      </div>

      <header className="rounded-xl border border-navy/10 bg-white p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Job</p>
            <h1 className="mt-1 text-2xl font-semibold text-navy">
              {row.name || "(no name)"}
            </h1>
            <p className="mt-1 text-sm text-ink/65">
              {row.service_type} · {formatDate(row.preferred_date)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <StatusBadge status={row.status} />
            {(row.status === "New" ||
              row.status === "Quoted" ||
              row.status === "Pending Follow-Up") && (
              <Link
                href={`/admin/quotes/${encodeURIComponent(decoded)}`}
                className="btn-primary text-sm"
              >
                {row.status === "New" ? "Send Quote" : "Re-send Quote"}
              </Link>
            )}
          </div>
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Customer">
            <Detail label="Name" value={row.name} />
            <Detail label="Phone" value={row.phone} tel={row.phone} />
            <Detail label="Email" value={row.email} mailto={row.email} />
            <Detail label="Address" value={row.address} />
          </Panel>
          <Panel title="Request">
            <Detail label="Service" value={row.service_type} />
            <Detail label="Preferred date" value={formatDate(row.preferred_date)} />
            <Detail label="Referral source" value={row.referral_source} />
            <Detail
              label="Submitted"
              value={
                row.submitted_at
                  ? new Date(row.submitted_at).toLocaleString()
                  : "—"
              }
            />
            <Detail label="UTM source" value={row.utm_source || "—"} />
          </Panel>
          <Panel title="Description">
            <p className="whitespace-pre-wrap text-sm text-ink/85">
              {row.description || "(no description)"}
            </p>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Actions">
            <JobActions
              jobId={decoded}
              currentStatus={row.status}
              balanceOwedCents={balanceCents}
              firstTouchSentAt={row.first_touch_sent_at || ""}
            />
          </Panel>
          <Panel title="Payment">
            <Detail
              label="Deposit paid"
              value={
                depositCents > 0
                  ? `$${(depositCents / 100).toFixed(2)}`
                  : "Not yet"
              }
            />
            <Detail
              label="Balance owed"
              value={
                balanceCents > 0
                  ? `$${(balanceCents / 100).toFixed(2)}`
                  : "Nothing owed"
              }
            />
            <Detail
              label="Saved card"
              value={row.stripe_payment_method_id ? "Yes" : "No"}
            />
          </Panel>
          <Panel title="Timing">
            <Detail
              label="First touch"
              value={
                row.first_touch_sent_at
                  ? new Date(row.first_touch_sent_at).toLocaleString()
                  : "Not recorded"
              }
            />
            <Detail
              label="Complete date"
              value={
                row.complete_date
                  ? new Date(row.complete_date).toLocaleString()
                  : "—"
              }
            />
            <Detail label="Job ID" value={row.job_id || decoded} mono />
          </Panel>
        </div>
      </section>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/60">
        {title}
      </h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Detail({
  label,
  value,
  tel,
  mailto,
  mono,
}: {
  label: string;
  value: string;
  tel?: string;
  mailto?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  const displayClass = mono
    ? "text-xs font-mono text-ink/80"
    : "text-sm text-ink/85";
  let content: React.ReactNode = value;
  if (tel) {
    content = (
      <a className="text-amber-forge hover:underline" href={`tel:${tel}`}>
        {value}
      </a>
    );
  } else if (mailto) {
    content = (
      <a className="text-amber-forge hover:underline" href={`mailto:${mailto}`}>
        {value}
      </a>
    );
  }
  return (
    <div className="flex items-baseline gap-3">
      <span className="w-32 shrink-0 text-xs font-medium uppercase tracking-wide text-ink/55">
        {label}
      </span>
      <span className={displayClass}>{content}</span>
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
