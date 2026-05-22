import { google } from 'googleapis'
import { getSheetAuth } from '@/lib/sheet/repo'

export const AUDIT_TAB_NAME = 'Audit'

export const AUDIT_HEADERS = [
  'timestamp',
  'actor',
  'action',
  'target',
  'before',
  'after',
  'notes',
] as const

export type AuditColumn = (typeof AUDIT_HEADERS)[number]

export const AUDIT_RANGE = `${AUDIT_TAB_NAME}!A:G`
export const AUDIT_HEADER_RANGE = `${AUDIT_TAB_NAME}!A1:G1`

export interface AuditEntry {
  actor: string
  action: string
  target: string
  before?: string
  after?: string
  notes?: string
}

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID
  if (!id) throw new Error('GOOGLE_SHEET_ID is not configured')
  return id
}

export async function appendAuditRow(entry: AuditEntry): Promise<void> {
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: AUDIT_RANGE,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          new Date().toISOString(),
          entry.actor,
          entry.action,
          entry.target,
          entry.before ?? '',
          entry.after ?? '',
          entry.notes ?? '',
        ],
      ],
    },
  })
}

export async function ensureAuditTab(): Promise<{ created: boolean }> {
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = getSpreadsheetId()

  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const existing = meta.data.sheets?.find(
    (s) => s.properties?.title === AUDIT_TAB_NAME,
  )
  if (existing) return { created: false }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { addSheet: { properties: { title: AUDIT_TAB_NAME } } },
      ],
    },
  })

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: AUDIT_HEADER_RANGE,
    valueInputOption: 'RAW',
    requestBody: { values: [Array.from(AUDIT_HEADERS)] },
  })

  return { created: true }
}
