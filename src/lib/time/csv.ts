/**
 * Tiny, dependency-free CSV helpers for exporting time entries.
 */

export interface CsvEntryRow {
  date: string;
  start: string;
  end: string;
  durationMin: number | null;
  project: string;
  client: string;
  category: string;
  description: string;
  billable: boolean;
  githubIssue: number | null;
}

/**
 * RFC 4180 CSV field escaping:
 * - Wrap in double quotes if the field contains a comma, quote, or newline
 * - Escape embedded quotes by doubling them
 */
export function escapeCsvField(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const HEADERS: Array<keyof CsvEntryRow> = [
  "date",
  "start",
  "end",
  "durationMin",
  "project",
  "client",
  "category",
  "description",
  "billable",
  "githubIssue",
];

const HEADER_LABELS: Record<keyof CsvEntryRow, string> = {
  date: "Date",
  start: "Start",
  end: "End",
  durationMin: "Duration (min)",
  project: "Project",
  client: "Client",
  category: "Category",
  description: "Description",
  billable: "Billable",
  githubIssue: "GitHub Issue",
};

/**
 * Serialize rows into CSV text. Always uses \r\n line endings per RFC.
 */
export function toCsv(rows: CsvEntryRow[]): string {
  const headerLine = HEADERS.map((h) => escapeCsvField(HEADER_LABELS[h])).join(",");
  const lines = rows.map((row) =>
    HEADERS.map((h) => escapeCsvField(row[h])).join(","),
  );
  return [headerLine, ...lines].join("\r\n") + "\r\n";
}
