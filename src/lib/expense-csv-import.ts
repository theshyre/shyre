/**
 * CSV-import logic for /business/[businessId]/expenses bulk-load.
 *
 * Pure module — no Supabase, no env, no fs. The route layer feeds it
 * raw CSV text + per-import context, gets back a list of rows ready
 * for `expenses` insertion plus a parallel list of skip reasons for
 * the user-facing summary. Server-side dedupe via
 * `import_source_id` happens at the DB layer (partial unique index)
 * so this module just produces a deterministic hash; collisions on
 * re-import surface as 23505 errors that the route maps to "already
 * imported."
 */

/** Source-system label written to expenses.imported_from. The
 *  import_runs.imported_from CHECK constraint accepts the same
 *  string — keep them in sync if a future provider adds a new
 *  variant. */
export const EXPENSE_CSV_SOURCE = "csv-expenses" as const;

/** Default category for every imported row. The source CSV has no
 *  category column, and per the import-flow design we don't try to
 *  guess from item text — guessing hides the work that needs doing
 *  (the user must audit categories before tax reports anyway).
 *  Stays consistent with the CHECK constraint on
 *  expenses.category. */
export const DEFAULT_IMPORTED_CATEGORY = "other" as const;

export interface ParsedExpenseRow {
  /** YYYY-MM-DD; ready for the date column. */
  incurred_on: string;
  /** Two-decimal numeric ready for the amount column. */
  amount: number;
  vendor: string | null;
  description: string | null;
  notes: string | null;
  /** Deterministic hash so re-imports dedupe via the partial unique
   *  index. Stable across CSV shape (column order doesn't matter) so
   *  long as the same content lands in the same fields. */
  import_source_id: string;
}

export interface ParseSkip {
  rowNumber: number;
  rawLine: string;
  reason: string;
}

export interface ParseResult {
  rows: ParsedExpenseRow[];
  skipped: ParseSkip[];
}

// ────────────────────────────────────────────────────────────────
// Tokenization
// ────────────────────────────────────────────────────────────────

/**
 * RFC 4180–lite CSV row tokenizer. Handles:
 *   - quoted fields with embedded commas + newlines
 *   - escaped double-quote (`""`) within a quoted field
 *   - trailing whitespace (trimmed for unquoted fields only)
 *
 * Returns one record array per logical CSV record (a record may span
 * multiple physical lines when a quoted field contains newlines —
 * which is exactly how Google Sheets exports the multi-line
 * Comments cells in the source spreadsheet).
 */
export function tokenizeCsv(csv: string): string[][] {
  const records: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalize CRLF → LF up front so the state machine only handles \n.
  const text = csv.replace(/\r\n?/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        // Lookahead: doubled quote → literal quote inside the field.
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      current.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      current.push(field);
      records.push(current);
      current = [];
      field = "";
      continue;
    }
    field += ch;
  }
  // Flush the trailing field/record (file may not end with a newline).
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    records.push(current);
  }
  // Trim trailing-empty records produced by a final newline.
  return records.filter((r) => !(r.length === 1 && r[0] === ""));
}

// ────────────────────────────────────────────────────────────────
// Per-field normalization
// ────────────────────────────────────────────────────────────────

/** Parse the CSV's Date column into YYYY-MM-DD. Accepts:
 *    M/D/YYYY        ← Google Sheets default for US locale
 *    MM/DD/YYYY
 *    YYYY-MM-DD      ← ISO; pass through after validation
 *  Anything else returns null and the row is skipped. */
export function parseExpenseDate(raw: string): string | null {
  const s = raw.trim();
  if (s === "") return null;

  // ISO already.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]);
    const d = Number(iso[3]);
    if (isValidYMD(y, m, d)) return s;
    return null;
  }

  // M/D/YYYY or MM/DD/YYYY.
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const m = Number(us[1]);
    const d = Number(us[2]);
    const y = Number(us[3]);
    if (isValidYMD(y, m, d)) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }

  return null;
}

function isValidYMD(y: number, m: number, d: number): boolean {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return false;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // Defensive: round-trip through Date to catch Feb 30 etc.
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Strip the CSV's currency-formatted amount cell ("$8,171.67",
 *  "$ 1,234.50", "1234") down to a positive number. Negative amounts
 *  are refused — expenses.amount has CHECK (amount >= 0). */
export function parseExpenseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** Split the CSV's "Item" cell into vendor + description.
 *
 *  The source spreadsheet uses a consistent " - " convention:
 *    "Linode - server"                          → vendor + short desc
 *    "G Suite - malcom.io: 1 user on the ..."   → vendor + colon-prefix desc
 *    "McEwen Gisvold LLP - Malcom IO LLP ..."   → vendor + the rest
 *
 *  Items without " - " (e.g. "Networking equipment from Platt") have no
 *  obvious vendor field; the whole string lands in description and
 *  vendor stays null. The user can edit individual rows after import.
 */
export function splitItemIntoVendorAndDescription(raw: string): {
  vendor: string | null;
  description: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed === "") return { vendor: null, description: null };

  // Split on the first " - " (with surrounding spaces) so single-dash
  // names like "AT&T-something" don't get torn apart.
  const idx = trimmed.indexOf(" - ");
  if (idx === -1) {
    return { vendor: null, description: trimmed };
  }
  const vendor = trimmed.slice(0, idx).trim();
  const description = trimmed.slice(idx + 3).trim();
  if (vendor === "") return { vendor: null, description: trimmed };
  if (description === "") return { vendor, description: null };
  return { vendor, description };
}

// ────────────────────────────────────────────────────────────────
// Idempotency hash
// ────────────────────────────────────────────────────────────────

/**
 * Build a deterministic 32-hex-char hash from the per-row fields.
 * Collisions across distinct CSV rows are vanishingly unlikely
 * because the source spreadsheet's "Comments" column carries a
 * unique invoice / order number per row in practice — even
 * monthly-recurring Linode bills with identical (date, amount,
 * vendor, description) differ by their invoice number in notes.
 *
 * Uses FNV-1a 32-bit twice with different seeds and concatenates,
 * producing a 16-byte hex string. Cryptographic strength isn't
 * required here — we just need stable, order-independent identity
 * for dedupe. Avoids importing crypto.subtle to keep the parser
 * synchronous + testable in plain Vitest.
 */
export function buildExpenseImportSourceId(parts: {
  incurred_on: string;
  amount: number;
  vendor: string | null;
  description: string | null;
  notes: string | null;
}): string {
  const canonical = [
    parts.incurred_on,
    parts.amount.toFixed(2),
    (parts.vendor ?? "").trim(),
    (parts.description ?? "").trim(),
    (parts.notes ?? "").trim(),
  ].join("|");
  const a = fnv1a32(canonical, 0x811c9dc5);
  const b = fnv1a32(canonical, 0x01000193);
  return (
    a.toString(16).padStart(8, "0") +
    b.toString(16).padStart(8, "0") +
    fnv1a32(canonical + "::tail", 0x811c9dc5).toString(16).padStart(8, "0") +
    fnv1a32(canonical + "::tail", 0x01000193).toString(16).padStart(8, "0")
  );
}

function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

// ────────────────────────────────────────────────────────────────
// End-to-end parse
// ────────────────────────────────────────────────────────────────

/** Mapping from the canonical Shyre field to a list of header
 *  aliases the user might write. Lowercased + trimmed for
 *  lookup. The source spreadsheet uses Date / Amount / Item /
 *  Comments — these are the names we recognize first. */
const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "incurred_on", "date incurred", "transaction date"],
  amount: ["amount", "total", "price", "cost"],
  item: ["item", "description", "memo", "details"],
  comments: ["comments", "notes", "comment"],
};

/** Find the index of the first column whose header matches one of
 *  the aliases for `field`. Returns -1 when not found. */
export function findColumnIndex(
  headerRow: readonly string[],
  field: keyof typeof HEADER_ALIASES,
): number {
  const aliases = HEADER_ALIASES[field] ?? [];
  for (let i = 0; i < headerRow.length; i++) {
    const name = (headerRow[i] ?? "").trim().toLowerCase();
    if (aliases.includes(name)) return i;
  }
  return -1;
}

/**
 * Parse a CSV string into rows ready for insert + a separate list
 * of skipped rows (with reasons). The header row is required —
 * Date and Amount columns are mandatory; Item and Comments columns
 * are optional but recommended.
 */
export function parseExpenseCsv(csv: string): ParseResult {
  const records = tokenizeCsv(csv);
  if (records.length === 0) return { rows: [], skipped: [] };

  const header = records[0]!;
  const dateIdx = findColumnIndex(header, "date");
  const amountIdx = findColumnIndex(header, "amount");
  const itemIdx = findColumnIndex(header, "item");
  const commentsIdx = findColumnIndex(header, "comments");

  if (dateIdx === -1 || amountIdx === -1) {
    // Without these the file isn't usable. Surface as a single skip
    // with rowNumber=0 so the route can show a clear error banner.
    // Tailored hint when the input looks like a single file path —
    // common when a user drags a CSV onto the textarea and the
    // browser pastes the path string instead of the file contents.
    const looksLikePathPaste =
      records.length === 1 &&
      header.length === 1 &&
      typeof header[0] === "string" &&
      /^\/.*\.csv$/i.test(header[0].trim());
    const reason = looksLikePathPaste
      ? `Looks like the file path was pasted instead of the file contents (` +
        `"${header[0]}"). Use the "Choose File" picker below the textarea, ` +
        `or drop the .csv file anywhere on the form — dropping into the ` +
        `textarea on most browsers pastes the path, not the content.`
      : 'Header row must contain "Date" and "Amount" columns (case-insensitive). Found: ' +
        header.map((h) => `"${h}"`).join(", ");
    return {
      rows: [],
      skipped: [
        {
          rowNumber: 0,
          rawLine: header.join(","),
          reason,
        },
      ],
    };
  }

  const rows: ParsedExpenseRow[] = [];
  const skipped: ParseSkip[] = [];

  for (let i = 1; i < records.length; i++) {
    const rec = records[i]!;
    const rowNumber = i + 1; // 1-indexed file line number incl. header
    const rawLine = rec.join(",");

    // Empty / whitespace-only row — skip silently rather than as an
    // error, since trailing blank lines are common in pasted CSVs.
    const isEmpty = rec.every((cell) => cell.trim() === "");
    if (isEmpty) continue;

    const dateRaw = rec[dateIdx] ?? "";
    const amountRaw = rec[amountIdx] ?? "";
    const itemRaw = itemIdx === -1 ? "" : (rec[itemIdx] ?? "");
    const commentsRaw =
      commentsIdx === -1 ? "" : (rec[commentsIdx] ?? "");

    const incurred_on = parseExpenseDate(dateRaw);
    if (!incurred_on) {
      skipped.push({
        rowNumber,
        rawLine,
        reason: `Invalid or missing date: "${dateRaw}"`,
      });
      continue;
    }

    const amount = parseExpenseAmount(amountRaw);
    if (amount === null) {
      skipped.push({
        rowNumber,
        rawLine,
        reason: `Invalid or missing amount: "${amountRaw}"`,
      });
      continue;
    }

    const { vendor, description } = splitItemIntoVendorAndDescription(itemRaw);
    const notes = commentsRaw.trim() === "" ? null : commentsRaw.trim();

    rows.push({
      incurred_on,
      amount,
      vendor,
      description,
      notes,
      import_source_id: buildExpenseImportSourceId({
        incurred_on,
        amount,
        vendor,
        description,
        notes,
      }),
    });
  }

  return { rows, skipped };
}
