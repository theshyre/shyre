import { describe, it, expect } from "vitest";
import { assertActionResult } from "./action-result";

describe("assertActionResult", () => {
  it("resolves silently on success", async () => {
    await expect(
      assertActionResult(Promise.resolve({ success: true })),
    ).resolves.toBeUndefined();
  });

  it("resolves silently when the action returns void", async () => {
    // Some actions don't return ActionResult at all (legacy paths
    // before runSafeAction). Treating them as success matches the
    // current behavior — caller's existing try/catch still fires
    // on a thrown error.
    await expect(
      assertActionResult(Promise.resolve(undefined)),
    ).resolves.toBeUndefined();
  });

  it("throws the verbatim message on UNKNOWN-coded failure", async () => {
    await expect(
      assertActionResult(
        Promise.resolve({
          success: false,
          error: { message: "Specific user-readable text", userMessageKey: "errors.unknown" },
        }),
      ),
    ).rejects.toThrow("Specific user-readable text");
  });

  it("falls back to userMessageKey when message isn't set (structured errors)", async () => {
    await expect(
      assertActionResult(
        Promise.resolve({
          success: false,
          error: { userMessageKey: "errors.authForbidden" },
        }),
      ),
    ).rejects.toThrow("errors.authForbidden");
  });

  it("falls back to the supplied fallback when no error fields are set", async () => {
    await expect(
      assertActionResult(
        Promise.resolve({ success: false }),
        "Delete failed",
      ),
    ).rejects.toThrow("Delete failed");
  });

  it("propagates a thrown rejection unchanged", async () => {
    await expect(
      assertActionResult(Promise.reject(new Error("network down"))),
    ).rejects.toThrow("network down");
  });
});
