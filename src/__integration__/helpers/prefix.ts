import { customAlphabet } from "nanoid";

const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
const nano = customAlphabet(alphabet, 8);

export const TEST_PREFIX_ROOT = "itest-";
export const TEST_EMAIL_DOMAIN = "@stint-test.local";

/**
 * Generate a unique prefix for a test file run.
 * All data created during the test must include this prefix so cleanup can find it.
 */
export function makeRunPrefix(): string {
  return `${TEST_PREFIX_ROOT}${nano()}-`;
}

export function assertTestPrefix(value: string, field = "value"): void {
  if (!value.includes(TEST_PREFIX_ROOT)) {
    throw new Error(
      `Safety check failed: ${field} "${value}" does not contain test prefix "${TEST_PREFIX_ROOT}"`
    );
  }
}
