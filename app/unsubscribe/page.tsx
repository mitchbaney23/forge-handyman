import type { Metadata } from "next";
import * as Sentry from "@sentry/nextjs";
import { verifyUnsubscribeToken } from "@/lib/automation/unsubscribe";
import { logger, maskEmail } from "@/lib/security/logger";
import { listJobs } from "@/lib/sheet/queries";
import { updateRowByJobId } from "@/lib/sheet/repo";

export const metadata: Metadata = {
  title: "Unsubscribe — Forge Handyman",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <Layout>
        <ErrorState
          title="Missing unsubscribe link"
          body="The link you used didn't include a token. Reply to any email from Forge and we'll unsubscribe you manually."
        />
      </Layout>
    );
  }

  const result = verifyUnsubscribeToken(token);
  if (!result.ok || !result.email) {
    return (
      <Layout>
        <ErrorState
          title="This unsubscribe link is no longer valid"
          body="It may have expired, been tampered with, or used a stale signature. Reply to any email from Forge and we'll unsubscribe you manually."
        />
      </Layout>
    );
  }

  let updatedCount = 0;
  try {
    const target = result.email.trim().toLowerCase();
    const jobs = await listJobs();
    const matches = jobs.filter(
      (row) =>
        (row.email || "").trim().toLowerCase() === target &&
        (row.opt_out || "").trim().toLowerCase() !== "true" &&
        Boolean(row.job_id),
    );
    for (const row of matches) {
      if (!row.job_id) continue;
      await updateRowByJobId(row.job_id, { opt_out: "true" });
      updatedCount += 1;
    }
    logger.info(
      { maskedEmail: maskEmail(result.email), rowsUpdated: updatedCount },
      "unsubscribe: opted out customer",
    );
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "unsubscribe", step: "update" },
    });
    logger.error({ err }, "unsubscribe: failed to update rows");
    return (
      <Layout>
        <ErrorState
          title="We hit an error processing your unsubscribe"
          body="Reply to any email from Forge and we'll unsubscribe you manually."
        />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8 text-center">
        <h1 className="text-2xl font-semibold text-emerald-900">
          You&rsquo;re unsubscribed.
        </h1>
        <p className="mt-3 text-sm text-emerald-900/85">
          We won&rsquo;t send automated review requests or seasonal follow-up
          emails to <span className="font-mono">{maskEmail(result.email)}</span>{" "}
          anymore.
        </p>
        <p className="mt-2 text-xs text-emerald-900/70">
          Updated {updatedCount} record{updatedCount === 1 ? "" : "s"}.
        </p>
        <p className="mt-4 text-sm text-emerald-900/85">
          We&rsquo;ll still reply to anything you email us directly. If you
          didn&rsquo;t mean to unsubscribe, just reply to any past email and
          we&rsquo;ll re-enable.
        </p>
      </div>
    </Layout>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[60vh] bg-cream py-16">
      <div className="mx-auto max-w-xl px-4">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-forge">
          Forge Handyman
        </p>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center">
      <h1 className="text-xl font-semibold text-amber-900">{title}</h1>
      <p className="mt-3 text-sm text-amber-900/85">{body}</p>
    </div>
  );
}
