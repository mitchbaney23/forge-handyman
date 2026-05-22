#!/usr/bin/env -S npx tsx
/**
 * Idempotent setup script for the Forge master Google Sheet.
 *
 * Behavior:
 *   1. Reads the current header row.
 *   2. If headers already match the canonical schema → no-op.
 *   3. Otherwise: duplicates Sheet1 → backup-{timestamp}, then writes the
 *      canonical 19-column header row to Sheet1!A1:S1.
 *
 * Required env (loaded from .env.local or the shell):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY
 *   GOOGLE_SHEET_ID
 *   BUSINESS_EMAIL
 *
 * Run with: npx tsx scripts/setup-sheet.ts
 */

import {
  SHEET_HEADERS,
  backupCurrentSheet,
  readHeaderRow,
  writeHeaderRow,
} from '../lib/sheet/repo'

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

async function main(): Promise<void> {
  const expected = Array.from(SHEET_HEADERS)
  console.log('Reading current header row…')
  const current = await readHeaderRow()
  console.log(`Found ${current.length} columns in current header.`)

  if (arraysEqual(current, expected)) {
    console.log('✓ Header row already matches canonical schema. Nothing to do.')
    return
  }

  if (current.length > 0) {
    console.log('Backing up current sheet before rewriting headers…')
    const backup = await backupCurrentSheet()
    if (backup) console.log(`✓ Backup created: tab "${backup.backupTitle}"`)
    else console.log('⚠ Could not back up — sheet not found by name "Sheet1".')
  }

  console.log('Writing canonical header row…')
  await writeHeaderRow()
  console.log('✓ Header row updated.')

  const verified = await readHeaderRow()
  if (!arraysEqual(verified, expected)) {
    console.error('✗ Verification failed — header row does not match after write.')
    process.exitCode = 1
    return
  }
  console.log('✓ Verified header row matches canonical schema.')
}

main().catch((err) => {
  console.error('Setup failed:', err)
  process.exitCode = 1
})
