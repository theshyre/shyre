"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Tracks whether a form's user-editable fields have diverged from
 * their initial values, so the Save button can be gated on
 * "anything actually changed?". Without this, every Save click
 * issued an UPDATE that touched the row's `updated_at` even when
 * nothing changed — and the user got success-toast feedback for
 * a no-op, which felt broken.
 *
 * Usage:
 *
 *   const formRef = useRef<HTMLFormElement>(null);
 *   const dirty = useFormDirty(formRef);
 *   <SubmitButton disabled={!dirty} ... />
 *
 * Implementation note: uses `useSyncExternalStore` (not
 * useState + listener) so we never call setState inside an effect
 * — the lint rule `react-hooks/set-state-in-effect` would flag the
 * synchronous reset path, and the alternatives (key-based remount,
 * synthetic event dispatch) all leak edge cases. The form IS the
 * external store; we subscribe to its `input` / `change` events
 * and derive dirty from a ref-stored snapshot of initial values.
 *
 * Detection rules:
 *   - Tracks every input/textarea/select that has a `name`. Fields
 *     without a name don't participate in FormData and therefore
 *     don't matter to the server action.
 *   - Initial value snapshot is taken on first mount; the form is
 *     clean until the user touches it.
 *   - Pass `successKey` to re-snapshot after a successful save (so
 *     the button goes back to disabled until the next change).
 *     Typically `useFormAction`'s `success` flag.
 */
export function useFormDirty(
  formRef: React.RefObject<HTMLFormElement | null>,
  successKey?: unknown,
): boolean {
  const snapshotRef = useRef<Record<string, string> | null>(null);

  // Capture / re-capture the snapshot on mount and whenever the
  // caller signals a successful save. No setState here — the
  // `useSyncExternalStore` subscriber will pick up the new
  // baseline on the next change event.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    snapshotRef.current = readNamedValues(form);
  }, [formRef, successKey]);

  const subscribe = useCallback(
    (cb: () => void) => {
      const form = formRef.current;
      if (!form) return () => {};
      form.addEventListener("input", cb);
      form.addEventListener("change", cb);
      return () => {
        form.removeEventListener("input", cb);
        form.removeEventListener("change", cb);
      };
    },
    [formRef],
  );

  const getSnapshot = useCallback((): boolean => {
    const form = formRef.current;
    const initial = snapshotRef.current;
    if (!form || !initial) return false;
    const current = readNamedValues(form);
    const keys = new Set([
      ...Object.keys(initial),
      ...Object.keys(current),
    ]);
    for (const k of keys) {
      if ((initial[k] ?? "") !== (current[k] ?? "")) return true;
    }
    return false;
  }, [formRef]);

  // SSR / pre-hydration: form is unmounted, can never be dirty.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

function readNamedValues(form: HTMLFormElement): Record<string, string> {
  const result: Record<string, string> = {};
  const els = form.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input[name], textarea[name], select[name]");
  for (const el of els) {
    if (!el.name) continue;
    if (el.type === "checkbox") {
      const cb = el as HTMLInputElement;
      result[el.name] = cb.checked ? "1" : "0";
      continue;
    }
    if (el.type === "radio") {
      const radio = el as HTMLInputElement;
      // Only record the value when this radio is the selected one;
      // otherwise let another option (or none) own the slot.
      if (radio.checked) result[el.name] = radio.value;
      continue;
    }
    result[el.name] = el.value;
  }
  return result;
}
