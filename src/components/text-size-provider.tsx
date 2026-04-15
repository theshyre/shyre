"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

/**
 * User-facing text-size preference. Three levels matching Liv: compact,
 * regular, large. Maps to the `data-text-size` attribute on <html> and a
 * root font-size so every rem in the app scales uniformly.
 */
export type TextSize = "compact" | "regular" | "large";

interface TextSizeContextValue {
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
  applyExternalTextSize: (size: TextSize) => void;
  sizes: readonly TextSize[];
}

const STORAGE_KEY = "stint-text-size";
const SIZES = ["compact", "regular", "large"] as const;
const SIZE_CHANGE_EVENT = "stint-text-size-change";

const TextSizeContext = createContext<TextSizeContextValue | null>(null);

function applyTextSize(size: TextSize): void {
  // CSS drives the actual font-size via `html[data-text-size="..."]`
  // rules in globals.css. Don't set `style.fontSize` directly: Next 16 /
  // React 19 reconciles the <html> element and strips inline styles that
  // weren't rendered from React's JSX tree. The attribute, mirroring how
  // the theme works, survives that reconciliation.
  document.documentElement.setAttribute("data-text-size", size);
}

function readStoredSize(): TextSize {
  if (typeof window === "undefined") return "regular";
  const stored = localStorage.getItem(STORAGE_KEY) as TextSize | null;
  return stored && SIZES.includes(stored) ? stored : "regular";
}

function subscribeToSize(onChange: () => void): () => void {
  window.addEventListener(SIZE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SIZE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function writeSize(next: TextSize): void {
  localStorage.setItem(STORAGE_KEY, next);
  applyTextSize(next);
  window.dispatchEvent(new Event(SIZE_CHANGE_EVENT));
}

export function TextSizeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  // Same pattern as ThemeProvider: localStorage is source of truth,
  // anti-flash script in <head> applies before hydration, React mirrors
  // via useSyncExternalStore.
  const textSize = useSyncExternalStore<TextSize>(
    subscribeToSize,
    readStoredSize,
    () => "regular",
  );

  const setTextSize = useCallback((next: TextSize) => writeSize(next), []);
  const applyExternalTextSize = useCallback(
    (next: TextSize) => writeSize(next),
    [],
  );

  return (
    <TextSizeContext.Provider
      value={{ textSize, setTextSize, applyExternalTextSize, sizes: SIZES }}
    >
      {children}
    </TextSizeContext.Provider>
  );
}

export function useTextSize(): TextSizeContextValue {
  const ctx = useContext(TextSizeContext);
  if (!ctx)
    throw new Error("useTextSize must be used within TextSizeProvider");
  return ctx;
}
