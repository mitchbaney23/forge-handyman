import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { QuoteComposer } from "./QuoteComposer";
import {
  BUDGET_RANGES,
  CONTACT_METHODS,
  CONTACT_TIMES,
  PROPERTY_TYPES,
  SERVICE_LABEL_BY_CODE,
  URGENCY_OPTIONS,
  type ServiceCategoryCode,
} from "@/lib/constants";
import { authOptions } from "@/lib/auth";
import { logger } from "@/lib/security/logger";
import { appendAuditRow } from "@/lib/sheet/audit-log";
import { findRowByJobId } from "@/lib/sheet/repo";

export const metadata: Metadata = {
  title: "Send Quote — Forge Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

function labelByCode<T extends { code: string; label: string }>(
  options: readonly T[],
  code: string,
): string {
  return options.find((o) => o.code === code)?.label || code || "—";
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);
  const found = await findRowByJobId(decoded);
  if (!found) notFound();
  const { row } = found;

  // Audit log on quote-builder open (Amendment §21.5.5).
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email ?? "unknown";
  try {
    await appendAuditRow({
      actor,
      action: "quote_builder.opened",
      target: decoded,
    });
  } catch (err) {
    logger.warn({ err, jobId: decoded }, "admin: audit row on quote-builder open failed");
  }

  const priorJobCount = Number(row.prior_job_count || "0");
  const isReturning =
    row.is_returning_customer === "true" || priorJobCount > 0;

  const categoryCodes = (row.service_categories || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ServiceCategoryCode[];
  const categoryLabels =
    categoryCodes.length > 0
      ? categoryCodes
          .map((code) => SERVICE_LABEL_BY_CODE[code] ?? code)
          .join(" · ")
      : SERVICE_LABEL_BY_CODE[(row.service_type || "other") as ServiceCategoryCode] ??
        row.service_type ??
        "—";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/admin/jobs/${decoded}`}
          className="text-xs font-medium text-ink/60 hover:text-navy"
        >
          ← Back to job
        </Link>
      </div>

      <header>
        <div className="flex flex-wrap items-center gap-3">
          <p className="eyebrow">Quote</p>
          {isReturning && (
            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
              Returning · {priorJobCount} prior
            </span>
          )}
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-navy">
          Send a Payment Link
        </h1>
        <p className="mt-2 text-sm text-ink/60">
          Generates a Stripe Payment Link and emails it to the customer. The
          deposit charges when they pay, saves their card on file, and flips
          this job&rsquo;s status to <strong>Quoted</strong>. The balance
          auto-charges later when you Mark Complete.
        </p>
      </header>

      <details className="rounded-xl border border-navy/10 bg-navy/[0.03] p-5 open:bg-navy/[0.05]">
        <summary className="cursor-pointer text-sm font-semibold text-navy">
          What the customer told us
        </summary>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <ContextItem label="Services they picked" value={categoryLabels} wide />
          <ContextItem
            label="Property type"
            value={labelByCode(PROPERTY_TYPES, row.property_type || "")}
          />
          <ContextItem
            label="Urgency"
            value={labelByCode(URGENCY_OPTIONS, row.urgency || "")}
          />
          <ContextItem
            label="Budget range"
            value={labelByCode(BUDGET_RANGES, row.budget_range || "")}
          />
          <ContextItem
            label="Best contact time"
            value={labelByCode(CONTACT_TIMES, row.best_contact_time || "any")}
          />
          <ContextItem
            label="Best contact method"
            value={labelByCode(CONTACT_METHODS, row.best_contact_method || "any")}
          />
          <ContextItem
            label="Preferred date"
            value={formatDate(row.preferred_date || "")}
          />
          <ContextItem
            label="Referral source"
            value={row.referral_source || "—"}
          />
          <ContextItem
            label="Submitted"
            value={
              row.submitted_at
                ? new Date(row.submitted_at).toLocaleString()
                : "—"
            }
          />
          {row.utm_source && (
            <ContextItem label="UTM source" value={row.utm_source} />
          )}
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-ink/55">
              Description
            </dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm text-ink/85">
              {row.description || "(no description)"}
            </dd>
          </div>
        </dl>
      </details>

      <QuoteComposer
        jobId={decoded}
        customerName={row.name || ""}
        customerEmail={row.email || ""}
        serviceType={categoryLabels}
        initialDescription={row.description || ""}
      />
    </div>
  );
}

function ContextItem({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink/55">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink/85">{value || "—"}</dd>
    </div>
  );
}
