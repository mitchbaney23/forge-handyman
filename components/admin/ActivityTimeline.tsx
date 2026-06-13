import { Icon, type IconName } from "@/lib/icons";
import { ACTIONS } from "@/lib/data/activity-actions";
import type { Activity } from "@/lib/data";

// Per-action visual treatment for the timeline: which icon represents the
// action and a human-readable label. Keyed by the dotted-noun action strings
// from lib/data/activity-actions.ts (ACTIONS). Unknown/legacy actions fall back
// to a generic clock icon + the raw action string (the column is free-form text
// so historical rows always render, never throw).
const ACTION_META: Record<string, { icon: IconName; label: string }> = {
  [ACTIONS.JOB_BOOKED]: { icon: "calendar", label: "Job booked" },
  [ACTIONS.JOB_STATUS_CHANGED]: { icon: "arrow-right", label: "Status changed" },
  [ACTIONS.JOB_COMPLETED]: { icon: "check", label: "Job completed" },
  [ACTIONS.JOB_FIRST_TOUCH_RECORDED]: {
    icon: "handshake",
    label: "First touch recorded",
  },
  [ACTIONS.QUOTE_SENT]: { icon: "tag", label: "Quote sent" },
  [ACTIONS.PAYMENT_LINK_CREATED]: {
    icon: "dollar",
    label: "Payment link created",
  },
  [ACTIONS.PAYMENT_DEPOSIT_SUCCEEDED]: {
    icon: "dollar",
    label: "Deposit paid",
  },
  [ACTIONS.PAYMENT_BALANCE_CHARGE_SUCCEEDED]: {
    icon: "dollar",
    label: "Balance charged",
  },
  [ACTIONS.PAYMENT_FAILED]: { icon: "dollar", label: "Payment failed" },
  [ACTIONS.BALANCE_CHARGED]: { icon: "dollar", label: "Balance charged" },
  [ACTIONS.BALANCE_CHARGE_FAILED]: {
    icon: "dollar",
    label: "Balance charge failed",
  },
  [ACTIONS.REFUND_ISSUED]: { icon: "dollar", label: "Refund issued" },
  [ACTIONS.REFUND_FAILED]: { icon: "dollar", label: "Refund failed" },
  [ACTIONS.CHARGE_FULLY_REFUNDED]: {
    icon: "dollar",
    label: "Charge fully refunded",
  },
  [ACTIONS.CHARGE_PARTIALLY_REFUNDED]: {
    icon: "dollar",
    label: "Charge partially refunded",
  },
  [ACTIONS.CUSTOMER_CREATED]: { icon: "home", label: "Customer created" },
  [ACTIONS.DISPATCH_SENT]: { icon: "phone", label: "Dispatched to David" },
  [ACTIONS.DISPATCH_APPROVED]: { icon: "check", label: "Dispatch approved" },
  [ACTIONS.DISPATCH_DECLINED]: { icon: "close", label: "Dispatch declined" },
  [ACTIONS.DISPATCH_NEEDS_SUB]: {
    icon: "phone",
    label: "Dispatch needs a sub",
  },
  [ACTIONS.NOTE_ADDED]: { icon: "brush", label: "Note added" },
  [ACTIONS.NUDGE_SENT]: { icon: "mail", label: "Seasonal nudge sent" },
  [ACTIONS.NUDGE_SKIPPED]: { icon: "mail", label: "Seasonal nudge skipped" },
  [ACTIONS.SEASONAL_NUDGE_SENT]: {
    icon: "mail",
    label: "Seasonal nudge sent",
  },
  [ACTIONS.SEASONAL_NUDGE_SKIPPED]: {
    icon: "mail",
    label: "Seasonal nudge skipped",
  },
  [ACTIONS.DATA_ANONYMIZED]: { icon: "shield", label: "Data anonymized" },
  [ACTIONS.SHEET_MIGRATION_APPLIED]: {
    icon: "box",
    label: "Sheet migration applied",
  },
  [ACTIONS.SHEET_MIGRATION_NOOP]: {
    icon: "box",
    label: "Sheet migration (no-op)",
  },
};

function actionMeta(action: string): { icon: IconName; label: string } {
  return ACTION_META[action] ?? { icon: "clock", label: action || "Activity" };
}

// Render the free-form actor string as a friendly label. `admin:<email>` ->
// the email; `telegram:<who>` -> "David (Telegram)" for the known dispatcher,
// else "<who> (Telegram)"; the bare non-human tokens get friendly names. The
// `claude` actor is handled separately (it gets a distinct AI chip) — this only
// returns the text label.
function actorLabel(actor: string): string {
  if (actor === "claude") return "Claude";
  if (actor === "stripe-webhook") return "Stripe";
  if (actor === "system") return "System";
  if (actor.startsWith("admin:")) {
    const email = actor.slice("admin:".length);
    return email || "Admin";
  }
  if (actor.startsWith("telegram:")) {
    const who = actor.slice("telegram:".length);
    if (who.toLowerCase() === "david") return "David (Telegram)";
    return who ? `${who} (Telegram)` : "Telegram";
  }
  return actor || "Unknown";
}

// "2h ago" style relative time off an ISO string. Mirrors JobCard.formatRelative
// so the admin reads consistently. Empty -> "—".
function formatRelative(iso: string): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!then) return iso;
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Full absolute timestamp for the title/hover tooltip. Empty -> "".
function formatAbsolute(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export interface ActivityTimelineProps {
  activities: Activity[];
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  if (activities.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-navy/15 bg-white/50 p-6 text-center text-sm text-ink/55">
        No activity yet.
      </div>
    );
  }

  return (
    <ol className="space-y-0">
      {activities.map((activity, index) => (
        <TimelineItem
          key={activity.id}
          activity={activity}
          isLast={index === activities.length - 1}
        />
      ))}
    </ol>
  );
}

function TimelineItem({
  activity,
  isLast,
}: {
  activity: Activity;
  isLast: boolean;
}) {
  const { icon, label } = actionMeta(activity.action);
  const isAi = activity.actor === "claude";
  const absolute = formatAbsolute(activity.at);

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {/* connector line down to the next item */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute left-[15px] top-8 bottom-0 w-px bg-navy/10"
        />
      )}
      <span
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
          isAi
            ? "border-violet-300 bg-violet-100 text-violet-700"
            : "border-navy/15 bg-white text-navy"
        }`}
      >
        <Icon name={icon} className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-medium text-navy">{label}</span>
          {isAi ? (
            <span className="inline-flex items-center rounded-full border border-violet-300 bg-violet-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-violet-700">
              AI · Claude
            </span>
          ) : (
            <span className="text-xs text-ink/55">{actorLabel(activity.actor)}</span>
          )}
          <span
            className="text-xs text-ink/45"
            title={absolute || undefined}
          >
            {formatRelative(activity.at)}
          </span>
        </div>
        {activity.notes && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink/75">
            {activity.notes}
          </p>
        )}
        {(activity.before || activity.after) && (
          <p className="mt-1 text-xs text-ink/55">
            {activity.before && (
              <span className="line-through opacity-70">{activity.before}</span>
            )}
            {activity.before && activity.after && (
              <span className="mx-1">→</span>
            )}
            {activity.after && <span className="font-medium">{activity.after}</span>}
          </p>
        )}
      </div>
    </li>
  );
}
