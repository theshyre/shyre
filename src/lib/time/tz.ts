/**
 * Timezone-aware helpers.
 *
 * The server runs in UTC but users expect all dates in THEIR local TZ.
 * We carry the client's offset (minutes WEST of UTC, per JS convention —
 * same as `new Date().getTimezoneOffset()`) in the `tz_offset` cookie.
 *
 * Dates flow through the UI as plain local-date strings (YYYY-MM-DD).
 * They only become UTC timestamps when hitting the DB, and that conversion
 * always goes through these helpers with the user's offset.
 */

const COOKIE_NAME = "tz_offset";

/**
 * Parse a cookie-stored tz offset. Defaults to 0 (UTC) when missing/bad.
 */
export function parseTzOffset(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  // Sanity: valid offsets are roughly -720..+840 minutes
  if (n < -840 || n > 840) return 0;
  return n;
}

export const TZ_COOKIE_NAME = COOKIE_NAME;

/**
 * Local-date string (YYYY-MM-DD) of the current moment in a given TZ.
 */
export function getLocalToday(tzOffsetMin: number, nowMs: number = Date.now()): string {
  // Subtract the offset to get "what the user's wall clock reads, expressed
  // as if it were UTC." Then pull year/month/day from that shifted Date.
  const shifted = new Date(nowMs - tzOffsetMin * 60 * 1000);
  return fmtYmdUtc(shifted);
}

/**
 * Local-date string for the Monday of the week containing the given local date.
 */
export function getLocalWeekStart(dateStr: string): string {
  const d = parseLocalDateUtc(dateStr);
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return fmtYmdUtc(d);
}

/**
 * Local-date string N days after the given local date.
 */
export function addLocalDays(dateStr: string, days: number): string {
  const d = parseLocalDateUtc(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return fmtYmdUtc(d);
}

/**
 * Convert a local-date string to the UTC timestamp representing that date's
 * midnight in the given timezone.
 *
 *   localDateMidnightUtc("2026-04-13", 420)  // PDT (UTC-7, offset 420)
 *     → 2026-04-13T07:00:00.000Z
 */
export function localDateMidnightUtc(dateStr: string, tzOffsetMin: number): Date {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) throw new Error(`Invalid local date: ${dateStr}`);
  const utc = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  return new Date(utc + tzOffsetMin * 60 * 1000);
}

/**
 * Convert a UTC timestamp to its local-date string in the user's TZ.
 */
export function utcToLocalDateStr(
  iso: string | Date,
  tzOffsetMin: number,
): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const shifted = new Date(d.getTime() - tzOffsetMin * 60 * 1000);
  return fmtYmdUtc(shifted);
}

/**
 * Compute the offset (minutes west of UTC) for a specific IANA timezone at a
 * given moment. Handles DST correctly.
 *
 *   getOffsetForZone("America/Los_Angeles", new Date("2026-07-01"))  // 420 (PDT)
 *   getOffsetForZone("America/Los_Angeles", new Date("2026-01-01"))  // 480 (PST)
 *
 * Returns 0 on unknown zone or environment without Intl support.
 */
export function getOffsetForZone(iana: string, atDate: Date = new Date()): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: iana,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(atDate);
    const map: Record<string, string> = {};
    for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
    const asIfUtc = Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour),
      Number(map.minute),
      Number(map.second),
    );
    return Math.round((atDate.getTime() - asIfUtc) / 60000);
  } catch {
    return 0;
  }
}

/**
 * Curated list of IANA zones for the settings picker. Runtime users can also
 * pick any zone supported by `Intl.supportedValuesOf("timeZone")`.
 */
export const COMMON_TIMEZONES: Array<{ region: string; zones: string[] }> = [
  {
    region: "Americas",
    zones: [
      "America/Anchorage",
      "America/Chicago",
      "America/Denver",
      "America/Halifax",
      "America/Los_Angeles",
      "America/Mexico_City",
      "America/New_York",
      "America/Phoenix",
      "America/Sao_Paulo",
      "America/Toronto",
      "America/Vancouver",
    ],
  },
  {
    region: "Europe",
    zones: [
      "Europe/Amsterdam",
      "Europe/Athens",
      "Europe/Berlin",
      "Europe/Dublin",
      "Europe/Istanbul",
      "Europe/London",
      "Europe/Madrid",
      "Europe/Paris",
      "Europe/Rome",
      "Europe/Stockholm",
      "Europe/Warsaw",
      "Europe/Zurich",
    ],
  },
  {
    region: "Asia / Oceania",
    zones: [
      "Asia/Dubai",
      "Asia/Hong_Kong",
      "Asia/Jakarta",
      "Asia/Kolkata",
      "Asia/Seoul",
      "Asia/Shanghai",
      "Asia/Singapore",
      "Asia/Tokyo",
      "Australia/Melbourne",
      "Australia/Sydney",
      "Pacific/Auckland",
      "Pacific/Honolulu",
    ],
  },
  {
    region: "Africa",
    zones: ["Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos"],
  },
  {
    region: "UTC",
    zones: ["UTC"],
  },
];

/**
 * Validate a YYYY-MM-DD string. Returns the string if valid, null otherwise.
 */
export function validateLocalDateStr(s: string | undefined): string | null {
  if (!s) return null;
  const match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Round-trip through Date to catch e.g. Feb 30
  const test = new Date(Date.UTC(y, m - 1, d));
  if (
    test.getUTCFullYear() !== y ||
    test.getUTCMonth() !== m - 1 ||
    test.getUTCDate() !== d
  ) {
    return null;
  }
  return s;
}

// ---------- helpers ----------

function parseLocalDateUtc(dateStr: string): Date {
  const parts = dateStr.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) throw new Error(`Invalid local date: ${dateStr}`);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

function fmtYmdUtc(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
