import { google } from "googleapis";
import { getSheetAuth } from "@/lib/sheet/repo";

function getSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not configured");
  return id;
}

// RFC 4180 CSV escaping. Wraps in quotes if the cell contains a comma,
// double-quote, newline, or carriage return. Doubles any inner quotes.
function escapeCsvCell(value: string): string {
  if (value === "") return "";
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowsToCsv(rows: unknown[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => escapeCsvCell(String(cell ?? "")))
        .join(","),
    )
    .join("\r\n");
}

/**
 * Exports every visible tab in the spreadsheet as CSV strings.
 * Returns an array of { tabName, csv } so the caller can attach
 * each one as a separate file (or concat them, depending on need).
 */
export async function exportAllTabsCsv(): Promise<
  { tabName: string; csv: string; rowCount: number }[]
> {
  const auth = getSheetAuth();
  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = getSpreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(title,hidden))",
  });
  const tabs = (meta.data.sheets ?? [])
    .filter((s) => !s.properties?.hidden)
    .map((s) => s.properties?.title ?? "")
    .filter(Boolean);

  const out: { tabName: string; csv: string; rowCount: number }[] = [];
  for (const tabName of tabs) {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName.replace(/'/g, "\\'")}'`,
    });
    const rows = response.data.values ?? [];
    out.push({
      tabName,
      csv: rowsToCsv(rows),
      rowCount: rows.length,
    });
  }
  return out;
}
