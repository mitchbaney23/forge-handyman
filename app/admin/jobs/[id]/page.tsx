import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JobActions } from "./JobActions";
import { CancelBookingButton } from "./CancelBookingButton";
import { addJobNoteAction } from "./actions";
import { ActivityTimeline } from "@/components/admin/ActivityTimeline";
import { AddNoteForm } from "@/components/admin/AddNoteForm";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  crmEnabled,
  findRowByJobId,
  getAppointmentByJobId,
  listActivitiesForJob,
} from "@/lib/data";
import { formatEtDay, formatEtTime } from "@/lib/scheduling/time";

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

  const jobId = row.job_id || decoded;
  const timelineEnabled = crmEnabled();
  const activities = timelineEnabled
    ? await listActivitiesForJob(jobId)
    : [];
  const appointment = timelineEnabled ? await getAppointmentByJobId(jobId) : null;

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
          <PhotosPanel csv={row.photo_urls || ""} />
        </div>

        <div className="space-y-6">
          {appointment && (
            <Panel title="Appointment">
              <Detail
                label="Scheduled"
                value={`${formatEtDay(new Date(appointment.startsAt))} · ${formatEtTime(
                  new Date(appointment.startsAt),
                )}–${formatEtTime(new Date(appointment.endsAt))}`}
              />
              <CancelBookingButton jobId={decoded} />
            </Panel>
          )}
          <Panel title="Actions">
            <JobActions
              jobId={decoded}
              currentStatus={row.status}
              balanceOwedCents={balanceCents}
              firstTouchSentAt={row.first_touch_sent_at || ""}
            />
          </Panel>
          <Panel title="Field dispatch">
            <Detail
              label="Status"
              value={row.dispatch_status || "Not dispatched"}
            />
            {row.dispatch_decision && (
              <Detail label="David's call" value={row.dispatch_decision} />
            )}
            <Detail
              label="Decided"
              value={
                row.dispatch_decided_at
                  ? new Date(row.dispatch_decided_at).toLocaleString()
                  : "—"
              }
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

      <section className="rounded-xl border border-navy/10 bg-white p-6 shadow-card">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-ink/60">
          Activity
        </h2>
        {timelineEnabled ? (
          <div className="space-y-5">
            <ActivityTimeline activities={activities} />
            <div className="border-t border-navy/10 pt-4">
              <AddNoteForm action={addJobNoteAction.bind(null, jobId)} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink/55">
            The activity timeline is available once you&rsquo;re on Postgres.
          </p>
        )}
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

function PhotosPanel({ csv }: { csv: string }) {
  const urls = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <div className="rounded-xl border border-navy/10 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/60">
        Photos
        <span className="ml-2 font-normal text-ink/40">{urls.length}</span>
      </h2>
      {urls.length === 0 ? (
        <p className="text-sm text-ink/55">
          Customer didn&rsquo;t attach any photos with the submission.
        </p>
      ) : (
        <div className="grid gap-2 grid-cols-3 sm:grid-cols-4">
          {urls.map((url, idx) => (
            <a
              key={idx}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex aspect-square items-center justify-center rounded-lg border border-navy/15 bg-navy/5 text-xs font-medium text-navy hover:border-navy/40 hover:bg-navy/10"
              title={`Open photo ${idx + 1} in Drive`}
            >
              Photo {idx + 1}
            </a>
          ))}
        </div>
      )}
      {urls.length > 0 && (
        <p className="mt-3 text-xs text-ink/50">
          Photos open in Google Drive — they live in your{" "}
          <span className="font-medium">Forge Photos / {csv ? "{job_id}" : ""}</span>{" "}
          folder.
        </p>
      )}
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
