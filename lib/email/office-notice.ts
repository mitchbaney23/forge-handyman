import { escapeHtml, sendGmail } from "@/lib/email/gmail";
import { getNotificationTo } from "@/lib/email/recipients";
import { formatCents, type QuoteLine } from "@/lib/quote-lines";

// Short internal emails to the office (NOTIFICATION_EMAILS: admin@ and
// operations@) at the moments worth checking: a quote went out to a customer,
// a customer paid a deposit or a balance, and a job was scheduled from the
// admin site or by Claude. Same plain style as the
// owner digest: no brand shell, no unsubscribe, a link straight to the job.
// Every caller sends these best-effort — a notice that fails must never undo
// a quote or fail a Stripe webhook.

function siteBase(): string {
  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://forgehandyman.com";
  return /vercel\.app$/i.test(base) ? "https://forgehandyman.com" : base;
}

function jobUrl(jobId: string): string {
  return `${siteBase()}/admin/jobs/${encodeURIComponent(jobId)}`;
}

// "Mitch (admin@…)" style label for who sent a quote, from the activity actor.
export function senderLabel(actor: string): string {
  if (actor.startsWith("claude:")) return `Claude (for ${actor.slice("claude:".length)})`;
  if (actor === "claude") return "Claude";
  if (actor.startsWith("admin:")) return actor.slice("admin:".length);
  return actor || "the admin site";
}

export interface OfficeNotice {
  subject: string;
  html: string;
  text: string;
}

type Row = [label: string, value: string];

function render(heading: string, rows: Row[], jobId: string, extraHtml = "", extraText = ""): {
  html: string;
  text: string;
} {
  const url = jobUrl(jobId);
  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;color:#1f2937;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;font-family:Inter,Arial,sans-serif;color:#1f2937;">
<h2 style="margin:0 0 12px;font-size:17px;color:#1B2A4A;">${escapeHtml(heading)}</h2>
<table cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.5;">${htmlRows}</table>${extraHtml}
<p style="margin:16px 0 0;font-size:14px;"><a href="${url}" style="color:#1B2A4A;font-weight:600;">Open the job</a></p>
</body></html>`;
  const text = [heading, "", ...rows.map(([l, v]) => `${l}: ${v}`), extraText, "", `Open the job: ${url}`]
    .filter((line, i, all) => !(line === "" && all[i - 1] === ""))
    .join("\n");
  return { html, text };
}

function linesBlock(lines: QuoteLine[] | undefined): { html: string; text: string } {
  if (!lines || lines.length === 0) return { html: "", text: "" };
  const items = lines.map(
    (l) => `${l.name}${l.addOn ? " (add-on price)" : ""} — ${l.qty} × ${formatCents(l.unitCents)} = ${formatCents(l.totalCents)}`,
  );
  return {
    html: `<ul style="margin:12px 0 0;padding:0 0 0 18px;font-size:14px;line-height:1.5;">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`,
    text: `\nLines:\n${items.map((i) => `- ${i}`).join("\n")}`,
  };
}

export interface QuoteSentNoticeInput {
  jobId: string;
  customerName: string;
  customerEmail: string;
  serviceType: string;
  depositCents: number;
  balanceCents: number;
  lines?: QuoteLine[];
  expiresAt: string;
  actor: string;
}

export function buildQuoteSentNotice(input: QuoteSentNoticeInput): OfficeNotice {
  const total = input.depositCents + input.balanceCents;
  const who = input.customerName || input.customerEmail || "a customer";
  const rows: Row[] = [
    ["Customer", `${who}${input.customerEmail ? ` <${input.customerEmail}>` : ""}`],
    ["Job", input.serviceType || "—"],
    ["Total", formatCents(total)],
    ["Due when they pay", formatCents(input.depositCents)],
    ...(input.balanceCents > 0
      ? ([["Balance at completion", formatCents(input.balanceCents)]] as Row[])
      : []),
    ["Link expires", formatDay(input.expiresAt)],
    ["Sent by", senderLabel(input.actor)],
  ];
  const lines = linesBlock(input.lines);
  return {
    subject: `Quote sent: ${who} — ${formatCents(total)}`,
    ...render(`Quote sent to ${who}`, rows, input.jobId, lines.html, lines.text),
  };
}

export interface PaymentNoticeInput {
  jobId: string;
  kind: "deposit" | "balance";
  customerName: string;
  customerEmail: string;
  serviceType: string;
  amountPaidCents: number;
  // What is still owed after this payment (deposit: the balance charged at
  // completion; balance link: 0).
  balanceCents: number;
  appointmentLabel?: string;
  // False when Stripe ran a guest checkout and no card was saved: Mark
  // Complete will have nothing to charge.
  cardSaved: boolean;
}

export function buildPaymentNotice(input: PaymentNoticeInput): OfficeNotice {
  const who = input.customerName || input.customerEmail || "a customer";
  const isDeposit = input.kind === "deposit";
  const rows: Row[] = [
    ["Customer", `${who}${input.customerEmail ? ` <${input.customerEmail}>` : ""}`],
    ["Job", input.serviceType || "—"],
    ["Paid", formatCents(input.amountPaidCents)],
    ...(isDeposit
      ? ([
          [
            "Balance at completion",
            input.balanceCents > 0 ? formatCents(input.balanceCents) : "None — paid in full",
          ],
          ["Status", "Booked"],
        ] as Row[])
      : ([["Balance", "Paid in full"]] as Row[])),
    ...(input.appointmentLabel ? ([["Scheduled", input.appointmentLabel]] as Row[]) : []),
    ...(isDeposit && input.balanceCents > 0
      ? ([
          [
            "Card on file",
            input.cardSaved
              ? "Saved for the balance"
              : "NOT saved — Mark Complete can't charge it; send a balance link instead",
          ],
        ] as Row[])
      : []),
  ];
  const heading = isDeposit ? `Deposit paid by ${who}` : `Balance paid by ${who}`;
  return {
    subject: `${isDeposit ? "Deposit paid" : "Balance paid"}: ${who} — ${formatCents(input.amountPaidCents)}`,
    ...render(heading, rows, input.jobId),
  };
}

export interface ScheduledNoticeInput {
  jobId: string;
  customerName: string;
  customerEmail: string;
  serviceType: string;
  address: string;
  whenLabel: string; // "Tue, Oct 20, 10:00 AM–12:00 PM"
  calendar: string;
  // What happened with the customer's confirmation email.
  confirmation: "sent" | "failed" | "no-email" | "skipped";
  actor: string;
}

const CONFIRMATION_LABEL: Record<ScheduledNoticeInput["confirmation"], string> = {
  sent: "Sent to the customer",
  failed: "Did NOT send (email error) — let them know the time yourself",
  "no-email": "Not sent — no email on file; call or text them the time",
  skipped: "Not sent — you chose not to email them",
};

export function buildScheduledNotice(input: ScheduledNoticeInput): OfficeNotice {
  const who = input.customerName || input.customerEmail || "a customer";
  const rows: Row[] = [
    ["Customer", `${who}${input.customerEmail ? ` <${input.customerEmail}>` : ""}`],
    ["Job", input.serviceType || "—"],
    ["When", `${input.whenLabel} (Eastern)`],
    ["Where", input.address || "—"],
    ["Calendar", input.calendar],
    ["Confirmation", CONFIRMATION_LABEL[input.confirmation]],
    ["Scheduled by", senderLabel(input.actor)],
  ];
  return {
    subject: `Scheduled: ${who} — ${input.whenLabel}`,
    ...render(`${who} is scheduled`, rows, input.jobId),
  };
}

export async function sendScheduledNotice(input: ScheduledNoticeInput): Promise<void> {
  await sendGmail({ to: getNotificationTo(), ...buildScheduledNotice(input) });
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "—";
  return d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export async function sendQuoteSentNotice(input: QuoteSentNoticeInput): Promise<void> {
  await sendGmail({ to: getNotificationTo(), ...buildQuoteSentNotice(input) });
}

export async function sendPaymentNotice(input: PaymentNoticeInput): Promise<void> {
  await sendGmail({ to: getNotificationTo(), ...buildPaymentNotice(input) });
}
