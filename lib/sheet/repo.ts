import { google } from 'googleapis'
import type { JWT } from 'google-auth-library'

export const SHEET_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'

export const SHEET_HEADERS = [
  'submitted_at',
  'name',
  'phone',
  'email',
  'address',
  'service_type',
  'preferred_date',
  'description',
  'referral_source',
  'status',
  'complete_date',
  'review_sent_at',
  'review_send_count',
  'review_received',
  'seasonal_nudge_last_sent',
  'opt_out',
  'first_touch_sent_at',
  'hours_to_first_touch',
  'utm_source',
  'job_id',
  'stripe_customer_id',
  'stripe_payment_method_id',
  'deposit_paid_cents',
  'balance_owed_cents',
] as const

export type SheetColumn = (typeof SHEET_HEADERS)[number]

export const SHEET_COLUMN_LETTER: Record<SheetColumn, string> = SHEET_HEADERS.reduce(
  (acc, name, index) => {
    acc[name] = String.fromCharCode(65 + index)
    return acc
  },
  {} as Record<SheetColumn, string>,
)

export const SHEET_RANGE_FULL = `Sheet1!A:${SHEET_COLUMN_LETTER[SHEET_HEADERS[SHEET_HEADERS.length - 1]]}`
export const SHEET_HEADER_RANGE = `Sheet1!A1:${SHEET_COLUMN_LETTER[SHEET_HEADERS[SHEET_HEADERS.length - 1]]}1`

export interface ContactRow {
  submitted_at: string
  name: string
  phone: string
  email: string
  address: string
  service_type: string
  preferred_date: string
  description: string
  referral_source: string
  status: string
  complete_date?: string
  review_sent_at?: string
  review_send_count?: string
  review_received?: string
  seasonal_nudge_last_sent?: string
  opt_out?: string
  first_touch_sent_at?: string
  hours_to_first_touch?: string
  utm_source?: string
  job_id?: string
  stripe_customer_id?: string
  stripe_payment_method_id?: string
  deposit_paid_cents?: string
  balance_owed_cents?: string
}

export type ContactRowPartial = Partial<ContactRow>

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID
  if (!id) throw new Error('GOOGLE_SHEET_ID is not configured')
  return id
}

function getBusinessEmail(): string {
  const email = process.env.BUSINESS_EMAIL
  if (!email) throw new Error('BUSINESS_EMAIL is not configured')
  return email
}

export function getSheetAuth(): JWT {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!clientEmail || !privateKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set')
  }
  return new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: [SHEET_SCOPE],
    subject: getBusinessEmail(),
  })
}

function rowToValues(row: ContactRow): string[] {
  return SHEET_HEADERS.map((header) => row[header] ?? '')
}

export async function appendContactRow(row: ContactRow): Promise<{ rowNumber: number }> {
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: SHEET_RANGE_FULL,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowToValues(row)] },
  })
  const updatedRange = response.data.updates?.updatedRange ?? ''
  const match = updatedRange.match(/!A(\d+):/)
  const rowNumber = match ? Number.parseInt(match[1], 10) : 0
  return { rowNumber }
}

export async function readHeaderRow(): Promise<string[]> {
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: SHEET_HEADER_RANGE,
  })
  const values = response.data.values
  if (!values || values.length === 0) return []
  return values[0].map((cell) => String(cell ?? '').trim())
}

export async function writeHeaderRow(): Promise<void> {
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: SHEET_HEADER_RANGE,
    valueInputOption: 'RAW',
    requestBody: { values: [Array.from(SHEET_HEADERS)] },
  })
}

export async function findRowByJobId(
  jobId: string,
): Promise<{ rowNumber: number; row: ContactRow } | null> {
  if (!jobId) return null
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: SHEET_RANGE_FULL,
  })
  const values = response.data.values ?? []
  if (values.length < 2) return null

  const jobIdColIndex = SHEET_HEADERS.indexOf('job_id')
  for (let i = 1; i < values.length; i++) {
    const cell = String(values[i][jobIdColIndex] ?? '').trim()
    if (cell === jobId) {
      const row: Record<string, string> = {}
      SHEET_HEADERS.forEach((header, idx) => {
        row[header] = String(values[i][idx] ?? '')
      })
      return { rowNumber: i + 1, row: row as unknown as ContactRow }
    }
  }
  return null
}

export async function updateRowByJobId(
  jobId: string,
  updates: ContactRowPartial,
): Promise<{ updated: boolean; rowNumber?: number }> {
  const found = await findRowByJobId(jobId)
  if (!found) return { updated: false }
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })

  const data = Object.entries(updates).map(([key, value]) => {
    const column = SHEET_COLUMN_LETTER[key as SheetColumn]
    return {
      range: `Sheet1!${column}${found.rowNumber}:${column}${found.rowNumber}`,
      values: [[value ?? '']],
    }
  })

  if (data.length === 0) return { updated: true, rowNumber: found.rowNumber }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  })
  return { updated: true, rowNumber: found.rowNumber }
}

export async function backupCurrentSheet(): Promise<{ backupTitle: string } | null> {
  const auth = getSheetAuth()
  const sheets = google.sheets({ version: 'v4', auth })
  const spreadsheetId = getSpreadsheetId()

  const meta = await sheets.spreadsheets.get({ spreadsheetId })
  const sheet1 = meta.data.sheets?.find((s) => s.properties?.title === 'Sheet1')
  const sourceSheetId = sheet1?.properties?.sheetId
  if (sourceSheetId == null) return null

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupTitle = `backup-${timestamp}`

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          duplicateSheet: {
            sourceSheetId,
            newSheetName: backupTitle,
          },
        },
      ],
    },
  })

  return { backupTitle }
}
