import { z } from "zod";

/**
 * Structured address schema with international support.
 * All fields optional — addresses can be partially filled.
 */
export const addressSchema = z.object({
  street: z.string().max(200).optional().default(""),
  street2: z.string().max(200).optional().default(""),
  city: z.string().max(100).optional().default(""),
  state: z.string().max(100).optional().default(""),
  postalCode: z.string().max(20).optional().default(""),
  country: z.string().max(2).optional().default(""),
});

export type Address = z.infer<typeof addressSchema>;

/**
 * Serialize an Address to a JSON string for database storage.
 */
export function serializeAddress(address: Address): string | null {
  const hasContent = Object.values(address).some((v) => v && v.length > 0);
  if (!hasContent) return null;
  return JSON.stringify(address);
}

/**
 * Deserialize a database address string to an Address object.
 * Handles both JSON (new format) and plain text (legacy format).
 */
export function deserializeAddress(raw: string | null): Address {
  if (!raw) return { street: "", street2: "", city: "", state: "", postalCode: "", country: "" };

  try {
    const parsed = JSON.parse(raw);
    return addressSchema.parse(parsed);
  } catch {
    // Legacy: plain text address — put it all in street
    return { street: raw, street2: "", city: "", state: "", postalCode: "", country: "" };
  }
}

/**
 * Format an address for single-line display.
 */
export function formatAddressOneLine(address: Address): string {
  const parts = [
    address.street,
    address.street2,
    address.city,
    address.state && address.postalCode
      ? `${address.state} ${address.postalCode}`
      : address.state || address.postalCode,
    address.country ? getCountryName(address.country) : "",
  ].filter((p) => p && p.length > 0);

  return parts.join(", ");
}

/**
 * Format an address for multi-line display.
 */
export function formatAddressMultiLine(address: Address): string[] {
  const lines: string[] = [];
  if (address.street) lines.push(address.street);
  if (address.street2) lines.push(address.street2);

  const cityLine = [
    address.city,
    address.state,
    address.postalCode,
  ].filter(Boolean).join(", ");
  if (cityLine) lines.push(cityLine);

  if (address.country) lines.push(getCountryName(address.country));
  return lines;
}

function getCountryName(code: string): string {
  return COUNTRIES.find((c) => c.code === code)?.name ?? code;
}

/**
 * Common countries list (ISO 3166-1 alpha-2).
 * Ordered with most common first, then alphabetical.
 */
export const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "CA", name: "Canada" },
  { code: "GB", name: "United Kingdom" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "SE", name: "Sweden" },
  { code: "NO", name: "Norway" },
  { code: "DK", name: "Denmark" },
  { code: "FI", name: "Finland" },
  { code: "CH", name: "Switzerland" },
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "IE", name: "Ireland" },
  { code: "NZ", name: "New Zealand" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "SG", name: "Singapore" },
  { code: "IN", name: "India" },
  { code: "BR", name: "Brazil" },
  { code: "MX", name: "Mexico" },
  { code: "AR", name: "Argentina" },
  { code: "CL", name: "Chile" },
  { code: "CO", name: "Colombia" },
  { code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },
  { code: "KE", name: "Kenya" },
  { code: "IL", name: "Israel" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "PT", name: "Portugal" },
  { code: "PL", name: "Poland" },
  { code: "CZ", name: "Czech Republic" },
  { code: "RO", name: "Romania" },
  { code: "HU", name: "Hungary" },
  { code: "PH", name: "Philippines" },
  { code: "TH", name: "Thailand" },
  { code: "VN", name: "Vietnam" },
  { code: "MY", name: "Malaysia" },
  { code: "ID", name: "Indonesia" },
  { code: "TW", name: "Taiwan" },
  { code: "HK", name: "Hong Kong" },
  { code: "CN", name: "China" },
] as const;
