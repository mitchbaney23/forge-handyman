"use server";

import { getServerSession } from "next-auth";
import * as Sentry from "@sentry/nextjs";
import { authOptions, isAllowlistedEmail } from "@/lib/auth";
import { logger } from "@/lib/security/logger";
import { appendAuditRow, ensureAuditTab } from "@/lib/sheet/audit-log";
import {
  SHEET_HEADERS,
  backupCurrentSheet,
  readHeaderRow,
  writeHeaderRow,
} from "@/lib/sheet/repo";

export type MigrationStep = {
  label: string;
  status: "done" | "skipped" | "failed";
  note?: string;
};

export type MigrationResult =
  | {
      ok: true;
      noOp: boolean;
      steps: MigrationStep[];
      finalColumnCount: number;
    }
  | {
      ok: false;
      error: string;
      stepsBeforeFailure: MigrationStep[];
    };

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export async function runSheetMigration(): Promise<MigrationResult> {
  const session = await getServerSession(authOptions);
  const actor = session?.user?.email ?? null;
  if (!actor || !isAllowlistedEmail(actor)) {
    return { ok: false, error: "Not authorized", stepsBeforeFailure: [] };
  }

  const steps: MigrationStep[] = [];
  const expected = Array.from(SHEET_HEADERS);

  // Step 1: read current header row
  let current: string[] = [];
  try {
    current = await readHeaderRow();
    steps.push({
      label: "Read current header row",
      status: "done",
      note: `Found ${current.length} column${current.length === 1 ? "" : "s"}.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { action: "setupSheet", step: "readHeaderRow" } });
    logger.error({ err }, "admin: setup-sheet readHeaderRow failed");
    steps.push({ label: "Read current header row", status: "failed", note: message });
    return { ok: false, error: message, stepsBeforeFailure: steps };
  }

  // Short-circuit if already matching
  if (arraysEqual(current, expected)) {
    steps.push({
      label: "Compare against canonical schema",
      status: "skipped",
      note: "Schema already matches — nothing to do.",
    });
    try {
      const audit = await ensureAuditTab();
      steps.push({
        label: "Ensure Audit tab exists",
        status: "done",
        note: audit.created ? "Created Audit tab + headers." : "Audit tab already present.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      steps.push({ label: "Ensure Audit tab exists", status: "failed", note: message });
      return { ok: false, error: message, stepsBeforeFailure: steps };
    }
    await appendAuditRow({
      actor,
      action: "sheet.migration_noop",
      target: "Sheet1",
      after: JSON.stringify({ columnCount: current.length }),
    });
    return { ok: true, noOp: true, steps, finalColumnCount: expected.length };
  }

  // Step 2: backup existing tab
  if (current.length > 0) {
    try {
      const backup = await backupCurrentSheet();
      steps.push({
        label: "Back up current sheet",
        status: "done",
        note: backup
          ? `Created tab "${backup.backupTitle}".`
          : "No Sheet1 tab found — nothing to back up.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Sentry.captureException(err, { tags: { action: "setupSheet", step: "backup" } });
      steps.push({ label: "Back up current sheet", status: "failed", note: message });
      return { ok: false, error: message, stepsBeforeFailure: steps };
    }
  } else {
    steps.push({
      label: "Back up current sheet",
      status: "skipped",
      note: "Sheet is empty — nothing to back up.",
    });
  }

  // Step 3: write canonical headers
  try {
    await writeHeaderRow();
    steps.push({
      label: "Write canonical header row",
      status: "done",
      note: `Wrote ${expected.length} columns (A–${columnLetter(expected.length - 1)}).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, { tags: { action: "setupSheet", step: "writeHeader" } });
    steps.push({ label: "Write canonical header row", status: "failed", note: message });
    return { ok: false, error: message, stepsBeforeFailure: steps };
  }

  // Step 4: verify
  try {
    const verified = await readHeaderRow();
    if (!arraysEqual(verified, expected)) {
      const note = `Header verification failed — expected ${expected.length}, got ${verified.length}.`;
      steps.push({ label: "Verify header row", status: "failed", note });
      return { ok: false, error: note, stepsBeforeFailure: steps };
    }
    steps.push({
      label: "Verify header row",
      status: "done",
      note: "Headers match canonical schema.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push({ label: "Verify header row", status: "failed", note: message });
    return { ok: false, error: message, stepsBeforeFailure: steps };
  }

  // Step 5: ensure Audit tab
  try {
    const audit = await ensureAuditTab();
    steps.push({
      label: "Ensure Audit tab exists",
      status: "done",
      note: audit.created
        ? "Created Audit tab + headers."
        : "Audit tab already present.",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    steps.push({ label: "Ensure Audit tab exists", status: "failed", note: message });
    return { ok: false, error: message, stepsBeforeFailure: steps };
  }

  await appendAuditRow({
    actor,
    action: "sheet.migration_applied",
    target: "Sheet1",
    before: JSON.stringify({ columnCount: current.length, headers: current }),
    after: JSON.stringify({ columnCount: expected.length, headers: expected }),
  });

  logger.info(
    { actor, fromCols: current.length, toCols: expected.length },
    "admin: sheet migration applied",
  );

  return { ok: true, noOp: false, steps, finalColumnCount: expected.length };
}

function columnLetter(index: number): string {
  let n = index;
  let result = "";
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}
