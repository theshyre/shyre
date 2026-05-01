/**
 * Helpers for consuming `runSafeAction` results from direct action
 * call sites — i.e. anywhere that doesn't go through
 * `useFormAction` (which already handles the result shape).
 *
 * Why this exists: server actions typed as `Promise<void>` actually
 * resolve to `Promise<ActionResult>` at runtime
 * (`{ success: false, error }` on failure). A naive
 * `await someAction(fd)` resolves on failure too — the catch
 * never fires, the UI silently shows "saved", and the error
 * lands in the admin error log.
 *
 * The user has hit this on three separate surfaces (week-timesheet
 * cell edits, import undo, invoice delete) before the pattern was
 * documented. Centralizing prevents the next one.
 */

interface ActionErrorPayload {
  message?: string;
  userMessageKey?: string;
}

/**
 * Read a server action's result and throw on failure. The action
 * is typed `Promise<void>` but actually returns `ActionResult` —
 * we cast to read it. On `success: false`, throws an Error whose
 * message is the user-targeted text the action provided
 * (verbatim for UNKNOWN-coded errors, fallback to userMessageKey
 * for structured errors, fallback to a generic when neither is
 * present).
 *
 * Usage:
 *   try {
 *     await assertActionResult(deleteFooAction(fd));
 *   } catch (err) {
 *     setError(err instanceof Error ? err.message : "Failed");
 *   }
 *
 * Returns `void` on success — by then the action has already run
 * and revalidatePath has fired. Caller doesn't need the success
 * shape.
 */
export async function assertActionResult(
  promise: Promise<unknown>,
  fallbackMessage = "Action failed",
): Promise<void> {
  const result = (await promise) as
    | { success: boolean; error?: ActionErrorPayload }
    | void
    | undefined;
  if (!result) return;
  if (typeof result !== "object" || !("success" in result)) return;
  if (result.success === true) return;
  const err = result.error;
  throw new Error(
    err?.message ?? err?.userMessageKey ?? fallbackMessage,
  );
}
