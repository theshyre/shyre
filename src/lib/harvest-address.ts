import { type Address, serializeAddress } from "@/lib/schemas/address";
import { COUNTRIES } from "@/lib/schemas/address";

/**
 * Parse Harvest's freeform multi-line address string into Shyre's
 * structured address shape.
 *
 * Harvest stores client addresses as a single text blob (the API
 * returns one `address` field of type `string | null`). The
 * conventional format is newline-separated:
 *
 *   6119 Canter Ln
 *   West Linn, OR 97068
 *
 * or with a suite + country:
 *
 *   1234 Main St
 *   Suite 200
 *   Brooklyn, NY 11201
 *   US
 *
 * Before this parser, the importer wrote the raw string straight
 * into `customers.address` and `deserializeAddress` fell through
 * its plain-text fallback — every byte landed in `street`, the
 * line break collapsed in the input element, and you got
 * "6119 Canter LnWest Linn, OR 97068" all in line 1 with city /
 * state / zip empty. Bookkeeper-flagged: invoices rendered with
 * mangled From/To addresses.
 *
 * Strategy:
 *   1. Split on \r\n or \n; trim and drop empty lines.
 *   2. The last line that matches a known country code/name peels
 *      off as `country` (ISO-2). Bare US/USA is recognized.
 *   3. The next-from-end line is parsed as "City, State Postal"
 *      (or "City, State", or just "City") via a tolerant regex.
 *   4. Whatever remains becomes `street` (line 1) and `street2`
 *      (line 2, when present).
 *
 * Returns the JSON-serialized form ready to drop into
 * `customers.address`. Returns `null` for null/empty input so the
 * column stays NULL rather than holding a hollow `{}`.
 */
export function parseHarvestAddressForStorage(
  raw: string | null,
): string | null {
  if (!raw) return null;
  const address = parseHarvestAddress(raw);
  return serializeAddress(address);
}

/** Same parse but returns the structured Address — exposed for
 *  tests and any future caller that wants the shape directly. */
export function parseHarvestAddress(raw: string): Address {
  const empty: Address = {
    street: "",
    street2: "",
    city: "",
    state: "",
    postalCode: "",
    country: "",
  };

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return empty;

  // Single-line input — best effort: if it matches the
  // city-state-zip pattern on its own treat it as a city line;
  // otherwise dump in street and leave the rest for manual edit.
  if (lines.length === 1) {
    const line = lines[0]!;
    const cityMatch = matchCityStatePostal(line);
    if (cityMatch) return { ...empty, ...cityMatch };
    return { ...empty, street: line };
  }

  let countryCode = "";
  const remaining = [...lines];

  // Country detection on the last line (US / USA / "United States" /
  // any ISO-2 / any name in COUNTRIES). Conservative — only peel it
  // off when the line looks like *just* a country, not a city line
  // that happens to end with a country fragment.
  const lastLineCountry = matchCountry(remaining[remaining.length - 1]!);
  if (lastLineCountry) {
    countryCode = lastLineCountry;
    remaining.pop();
  }

  // City-state-postal lives on the now-last line.
  if (remaining.length > 0) {
    const candidate = remaining[remaining.length - 1]!;
    const cityMatch = matchCityStatePostal(candidate);
    if (cityMatch) {
      remaining.pop();
      const street = remaining[0] ?? "";
      const street2 = remaining.length > 1 ? remaining.slice(1).join(", ") : "";
      return {
        ...empty,
        street,
        street2,
        city: cityMatch.city ?? "",
        state: cityMatch.state ?? "",
        postalCode: cityMatch.postalCode ?? "",
        country: countryCode,
      };
    }
  }

  // Fallback: no recognizable city line. Stuff lines 1..N into
  // street + street2 so at least the data is preserved.
  // (User can reformat manually.)
  const street = remaining[0] ?? "";
  const street2 =
    remaining.length > 1 ? remaining.slice(1).join(", ") : "";
  return { ...empty, street, street2, country: countryCode };
}

/** Try to parse "City, State PostalCode" / "City, State" / "City"
 *  / "City, ST 12345-6789". Returns the matched parts or null when
 *  the line doesn't look like a city line. */
function matchCityStatePostal(line: string): {
  city?: string;
  state?: string;
  postalCode?: string;
} | null {
  // "City, State Postal" — the most common US shape. Postal can be
  // 5 digits, 5+4, or international alphanumeric (UK / CA / etc.).
  // State is 1-3 words to capture "DC", "Puerto Rico", etc.
  const csp =
    /^([^,]+?)\s*,\s*([A-Za-z][A-Za-z .'-]{0,40}?)\s+([A-Za-z0-9][A-Za-z0-9 -]{2,11})$/;
  const m = csp.exec(line);
  if (m && m[1] && m[2] && m[3]) {
    return {
      city: m[1].trim(),
      state: m[2].trim(),
      postalCode: m[3].trim(),
    };
  }
  // "City, State" — no postal.
  const cs = /^([^,]+?)\s*,\s*([A-Za-z][A-Za-z .'-]{0,40})$/;
  const m2 = cs.exec(line);
  if (m2 && m2[1] && m2[2]) {
    return { city: m2[1].trim(), state: m2[2].trim() };
  }
  // Bare "City Postal" with no state separator (rare, but seen on
  // Canadian / UK addresses pasted without a comma).
  const cp = /^(.+?)\s+([A-Z]\d[A-Z]\s?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})$/i;
  const m3 = cp.exec(line);
  if (m3 && m3[1] && m3[2]) {
    return { city: m3[1].trim(), postalCode: m3[2].trim() };
  }
  return null;
}

/** Detect a "country only" line. Returns ISO-2 or empty string when
 *  the line looks like part of an address (i.e. has a comma or
 *  digits beyond a postal). */
function matchCountry(line: string): string {
  const norm = line.trim();
  // If the line has commas or digits it's almost certainly not just
  // a country.
  if (/[0-9,]/.test(norm)) return "";
  const upper = norm.toUpperCase();
  if (upper === "US" || upper === "USA" || upper === "U.S." || upper === "U.S.A.") {
    return "US";
  }
  if (upper === "UK" || upper === "U.K.") return "GB";
  // ISO-2 exact match
  if (/^[A-Z]{2}$/.test(upper)) {
    const hit = COUNTRIES.find((c) => c.code === upper);
    if (hit) return hit.code;
  }
  // Country name match (case-insensitive)
  const hit = COUNTRIES.find(
    (c) => c.name.toLowerCase() === norm.toLowerCase(),
  );
  if (hit) return hit.code;
  return "";
}
