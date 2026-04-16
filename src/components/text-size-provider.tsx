"use client";

/**
 * Shyre's text-size provider — thin binding around the shared factory
 * in `@theshyre/theme`.
 */

import { createTextSizeStore, type TextSize } from "@theshyre/theme";

const store = createTextSizeStore({ storageKey: "stint-text-size" });

export const TextSizeProvider = store.TextSizeProvider;
export const useTextSize = store.useTextSize;
export type { TextSize };
