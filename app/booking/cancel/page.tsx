import type { Metadata } from "next";
import { verifyCancelToken } from "@/lib/scheduling/cancel-token";
import { getAppointmentById } from "@/lib/data";
import { formatEtDay, formatEtTime } from "@/lib/scheduling/time";
import { CancelByTokenButton } from "./CancelByTokenButton";
import { BUSINESS } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Cancel appointment — Forge Handyman Service",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-[560px] items-center px-5 py-16">
      <div className="w-full rounded-[10px] border-2 border-ink bg-[#F6EEDD] p-[30px] text-center shadow-ticket">
        {children}
      </div>
    </main>
  );
}

export default async function CancelBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const verified = token ? verifyCancelToken(token) : { ok: false as const };

  if (!verified.ok || !verified.appointmentId) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold text-ink">
          This link isn&rsquo;t valid
        </h1>
        <p className="mx-auto mt-2.5 max-w-[44ch] text-[15px] text-ink-2">
          The cancellation link is invalid or has expired. To change an
          appointment, call us at{" "}
          <a href={BUSINESS.phoneHref} className="font-semibold text-orange underline underline-offset-[3px]">
            {BUSINESS.phone}
          </a>
          .
        </p>
      </Shell>
    );
  }

  const appt = await getAppointmentById(verified.appointmentId);

  if (!appt) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold text-ink">
          We couldn&rsquo;t find that appointment
        </h1>
        <p className="mx-auto mt-2.5 max-w-[44ch] text-[15px] text-ink-2">
          It may have already been removed. Call us at{" "}
          <a href={BUSINESS.phoneHref} className="font-semibold text-orange underline underline-offset-[3px]">
            {BUSINESS.phone}
          </a>{" "}
          if you need a hand.
        </p>
      </Shell>
    );
  }

  const whenLabel = `${formatEtDay(new Date(appt.startsAt))} at ${formatEtTime(
    new Date(appt.startsAt),
  )}`;

  if (appt.status !== "Booked") {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-bold text-ink">
          Already cancelled
        </h1>
        <p className="mx-auto mt-2.5 max-w-[44ch] text-[15px] text-ink-2">
          Your appointment on {whenLabel} is already cancelled. Want a new time?{" "}
          <a href="/contact" className="font-semibold text-orange underline underline-offset-[3px]">
            Book again
          </a>
          .
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="font-display text-2xl font-bold text-ink">
        Cancel your appointment
      </h1>
      <p className="mx-auto mb-5 mt-2.5 max-w-[44ch] text-[15px] text-ink-2">
        You&rsquo;re booked for{" "}
        <span className="font-semibold text-ink">{whenLabel}</span>. Cancelling
        frees the time for someone else — please give us 24 hours&rsquo; notice
        when you can.
      </p>
      <div className="flex justify-center">
        <CancelByTokenButton token={token as string} whenLabel={whenLabel} />
      </div>
    </Shell>
  );
}
