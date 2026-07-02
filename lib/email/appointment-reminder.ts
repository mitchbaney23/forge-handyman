import { BUSINESS } from "@/lib/constants";
import { brandShell, escapeHtml, sendGmail } from "@/lib/email/gmail";
import { buildCancelUrl } from "@/lib/scheduling/cancel-token";
import { formatEtDay, formatEtTime } from "@/lib/scheduling/time";

// Day-before appointment reminder, sent by the daily lifecycle cron. Includes
// the same tokenized self-service cancel link as the booking confirmation.

export interface AppointmentReminderInput {
  toEmail: string;
  toName: string;
  serviceType: string;
  appointmentId: string;
  startsAt: string;
  endsAt: string;
}

function firstNameOf(name: string): string {
  return (name || "there").split(/\s+/)[0] || "there";
}

function slotLabel(data: AppointmentReminderInput): string {
  const starts = new Date(data.startsAt);
  const ends = new Date(data.endsAt);
  return `${formatEtDay(starts)} · ${formatEtTime(starts)}–${formatEtTime(ends)}`;
}

export async function sendAppointmentReminderEmail(
  data: AppointmentReminderInput,
): Promise<void> {
  const label = slotLabel(data);
  const cancelUrl = buildCancelUrl(data.appointmentId);

  const html = brandShell(
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;">Hi ${escapeHtml(firstNameOf(data.toName))},</p>
     <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
       Quick reminder — David is coming out <strong>tomorrow</strong> for your
       <strong>${escapeHtml(data.serviceType)}</strong> job:
     </p>
     <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#1B2A4A;">${escapeHtml(label)}</p>
     <p style="margin:0 0 16px;font-size:14px;color:#374151;line-height:1.55;">
       No need to do anything — David will text if anything changes on his end.
       If the time no longer works, reply to this email or
       <a href="${cancelUrl}" style="color:#D97706;">cancel the booking</a> and
       we'll find a new slot.
     </p>
     <p style="margin:24px 0 0;font-size:14px;color:#374151;">&mdash; The Forge team</p>`,
    BUSINESS.mailingAddress,
  );

  const text = [
    `Hi ${firstNameOf(data.toName)},`,
    "",
    `Quick reminder — David is coming out tomorrow for your ${data.serviceType} job:`,
    "",
    label,
    "",
    "No need to do anything — David will text if anything changes on his end.",
    `If the time no longer works, reply to this email or cancel here: ${cancelUrl}`,
    "",
    "— The Forge team",
    "",
    BUSINESS.mailingAddress,
  ].join("\n");

  await sendGmail({
    to: data.toEmail,
    subject: `Reminder: David comes out tomorrow (${label})`,
    html,
    text,
  });
}
