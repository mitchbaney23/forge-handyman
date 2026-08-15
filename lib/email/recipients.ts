import { logger } from "@/lib/security/logger";

// Who at Forge gets internal notifications: new leads, the daily digest, the
// nightly backup.
//
// This is deliberately NOT BUSINESS_EMAIL. BUSINESS_EMAIL is the Workspace
// mailbox the service account impersonates via domain-wide delegation — it is
// the sending *identity* (From, Reply-To, and the Gmail `subject` claim), not a
// distribution list. Every internal notification used to reuse it as the
// destination too, which meant the recipient could never differ from the
// sender, and any Workspace-side change to that mailbox (an alias, a rename, a
// routing rule) silently moved every lead to a different inbox with nothing in
// the code or the logs to show for it.
//
// NOTIFICATION_EMAILS is a comma-separated list. Unset, it falls back to
// BUSINESS_EMAIL alone — the previous behavior, so this is a safe no-op deploy.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function getNotificationRecipients(): string[] {
  const configured = process.env.NOTIFICATION_EMAILS ?? "";
  const fallback = process.env.BUSINESS_EMAIL ?? "";

  const raw = (configured.trim() ? configured : fallback)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const valid: string[] = [];
  const seen = new Set<string>();
  for (const address of raw) {
    if (!EMAIL_RE.test(address)) {
      // A typo in one entry must not silently swallow the whole list — drop the
      // bad address, keep the rest, and make the typo visible in the logs.
      logger.warn({ address }, "notification-recipients: skipping malformed address");
      continue;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(address);
  }

  if (valid.length === 0) {
    // Nothing usable configured. Throw rather than send into the void — a lead
    // notification with no recipient is a lost job, which is the exact failure
    // this module exists to prevent.
    throw new Error(
      "No valid notification recipients — set NOTIFICATION_EMAILS or BUSINESS_EMAIL",
    );
  }
  return valid;
}

// The RFC 2822 `To:` header value — a comma-separated address list.
export function getNotificationTo(): string {
  return getNotificationRecipients().join(", ");
}
