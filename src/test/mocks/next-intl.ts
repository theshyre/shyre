import { vi } from "vitest";

/**
 * Creates a mock translation function that returns the key path.
 * For testing, we verify the correct translation key is used
 * rather than the translated string.
 */
export function createMockTranslations(): (
  key: string,
  params?: Record<string, string>
) => string {
  return (key: string, params?: Record<string, string>) => {
    if (params) {
      let result = key;
      for (const [k, v] of Object.entries(params)) {
        result += `|${k}=${v}`;
      }
      return result;
    }
    return key;
  };
}

export function mockNextIntl(): void {
  vi.mock("next-intl", () => ({
    useTranslations: () => createMockTranslations(),
  }));

  vi.mock("next-intl/server", () => ({
    getTranslations: async () => createMockTranslations(),
    getLocale: async () => "en",
    getMessages: async () => ({}),
  }));
}
