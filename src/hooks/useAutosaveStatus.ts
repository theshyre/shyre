"use client";

import { useCallback, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaveStatus {
  status: SaveStatus;
  /** When the last successful save resolved (ms since epoch). */
  lastSavedAt: number | null;
  /** Last error message if status === 'error'. */
  lastError: string | null;
  /**
   * Wrap a save promise so the status transitions idle|saved → saving → saved (or error).
   * Concurrent saves coalesce — status stays "saving" while any inflight promise is unresolved.
   */
  wrap: <T>(p: Promise<T>) => Promise<T>;
  /** Reset status to idle — useful when the form unmounts mid-save. */
  reset: () => void;
}

/**
 * Autosave status state machine. Any surface that silently writes to the
 * server (on blur, on debounce, on change) must render <SaveStatus/> driven
 * by this hook. "Silent saves are a bug" — CLAUDE.md.
 */
export function useAutosaveStatus(): AutosaveStatus {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  // Ref-counted inflight tracker so concurrent saves collapse into one "saving".
  const inflight = useRef(0);

  const wrap = useCallback(async <T,>(p: Promise<T>): Promise<T> => {
    inflight.current += 1;
    setStatus("saving");
    try {
      const result = await p;
      inflight.current -= 1;
      if (inflight.current === 0) {
        setStatus("saved");
        setLastSavedAt(Date.now());
        setLastError(null);
      }
      return result;
    } catch (err) {
      inflight.current = Math.max(0, inflight.current - 1);
      if (inflight.current === 0) {
        setStatus("error");
        setLastError(err instanceof Error ? err.message : String(err));
      }
      throw err;
    }
  }, []);

  const reset = useCallback(() => {
    inflight.current = 0;
    setStatus("idle");
    setLastError(null);
  }, []);

  return { status, lastSavedAt, lastError, wrap, reset };
}
