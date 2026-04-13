/**
 * MFA backup/recovery code utilities.
 * Generates 10 single-use codes, stores hashed versions in the database.
 */

const CODE_COUNT = 10;
const CODE_LENGTH = 8;

/**
 * Generate a set of random backup codes.
 * Returns the plain-text codes (shown to user once) and their hashes (stored in DB).
 */
export async function generateBackupCodes(): Promise<{
  plainCodes: string[];
  hashedCodes: string[];
}> {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < CODE_COUNT; i++) {
    const code = generateCode();
    plainCodes.push(code);
    const hash = await hashCode(code);
    hashedCodes.push(hash);
  }

  return { plainCodes, hashedCodes };
}

/**
 * Generate a single random alphanumeric code.
 * Format: XXXX-XXXX (8 chars with hyphen for readability)
 */
function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I,O,0,1 to avoid confusion
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;
    code += chars[byte % chars.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Hash a backup code using SHA-256.
 * We hash before storing so the DB never contains usable codes.
 */
export async function hashCode(code: string): Promise<string> {
  const normalized = code.replace(/-/g, "").toUpperCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Format codes for display/download.
 */
export function formatCodesForDownload(
  codes: string[],
  appName: string
): string {
  const header = `${appName} — MFA Backup Codes`;
  const warning = "Each code can only be used once. Store these somewhere safe.";
  const codeList = codes.map((c, i) => `  ${String(i + 1).padStart(2, " ")}. ${c}`).join("\n");
  const generated = `Generated: ${new Date().toISOString().split("T")[0]}`;
  return `${header}\n${warning}\n\n${codeList}\n\n${generated}\n`;
}
