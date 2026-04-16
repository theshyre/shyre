import { describe, it, expect, vi, beforeEach } from "vitest";
import { AppError } from "@/lib/errors";

// --- Mocks ---
const mockGetUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
  }),
}));

const mockRedirect = vi.fn((path: string): never => {
  const err = new Error(`NEXT_REDIRECT ${path}`) as Error & { digest: string };
  err.digest = `NEXT_REDIRECT;replace;${path};307;`;
  throw err;
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => mockRedirect(path),
}));

const mockLogError = vi.fn();
vi.mock("@/lib/logger", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

import { runSafeAction } from "./safe-action";

describe("runSafeAction", () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockRedirect.mockClear();
    mockLogError.mockReset();
  });

  it("redirects to /login when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await expect(
      runSafeAction(new FormData(), async () => {}, "test"),
    ).rejects.toThrow(/NEXT_REDIRECT.*\/login/);
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("returns { success: true } when the action resolves", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await runSafeAction(
      new FormData(),
      async () => {},
      "happy",
    );
    expect(result).toEqual({ success: true });
  });

  it("passes formData and ActionContext (supabase, userId) into the action fn", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u42" } } });
    const fd = new FormData();
    fd.set("k", "v");
    const spy = vi.fn<
      (formData: FormData, ctx: { supabase: unknown; userId: string }) => Promise<void>
    >(async () => {});
    await runSafeAction(fd, spy, "ctx-test");
    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) throw new Error("expected a call");
    const [passedFd, ctx] = call;
    expect(passedFd).toBe(fd);
    expect(ctx.userId).toBe("u42");
    expect(ctx.supabase).toBeDefined();
  });

  it("serializes an AppError via toUserSafe() when the action throws", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const appErr = AppError.validation("bad", { field: "required" });
    const result = await runSafeAction(
      new FormData(),
      async () => {
        throw appErr;
      },
      "val-fail",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
      expect(result.error.userMessageKey).toBe("errors.validation");
      expect(result.error.fieldErrors).toEqual({ field: "required" });
    }
  });

  it("wraps a generic Error into AppError.unknown serialization", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await runSafeAction(
      new FormData(),
      async () => {
        throw new Error("boom");
      },
      "generic-fail",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN");
    }
  });

  it("wraps a non-Error thrown value (string, object) into AppError.unknown", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await runSafeAction(
      new FormData(),
      async () => {
        throw "string-error";
      },
      "string-fail",
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UNKNOWN");
    }
  });

  it("logs the serialized error with userId + actionName on failure", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u99" } } });
    await runSafeAction(
      new FormData(),
      async () => {
        throw new Error("logged");
      },
      "action-name",
    );
    expect(mockLogError).toHaveBeenCalledOnce();
    const call = mockLogError.mock.calls[0]!;
    expect(call[1]).toEqual({ userId: "u99", action: "action-name" });
  });

  it("re-throws a Next.js redirect thrown inside the action (digest NEXT_REDIRECT)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const nextErr = new Error("NEXT_REDIRECT") as Error & { digest: string };
    nextErr.digest = "NEXT_REDIRECT;replace;/somewhere;307;";
    await expect(
      runSafeAction(
        new FormData(),
        async () => {
          throw nextErr;
        },
        "redirect-pass",
      ),
    ).rejects.toBe(nextErr);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("re-throws a Next.js notFound thrown inside the action (digest NEXT_NOT_FOUND)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const nextErr = new Error("NEXT_NOT_FOUND") as Error & { digest: string };
    nextErr.digest = "NEXT_NOT_FOUND;";
    await expect(
      runSafeAction(
        new FormData(),
        async () => {
          throw nextErr;
        },
        "notfound-pass",
      ),
    ).rejects.toBe(nextErr);
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it("does NOT re-throw when digest is present but unrelated to Next.js internals", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const fakeErr = new Error("custom") as Error & { digest: string };
    fakeErr.digest = "MY_CUSTOM_DIGEST;";
    const result = await runSafeAction(
      new FormData(),
      async () => {
        throw fakeErr;
      },
      "not-next",
    );
    expect(result.success).toBe(false);
  });

  it("does NOT re-throw when the thrown value has no digest at all", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const result = await runSafeAction(
      new FormData(),
      async () => {
        throw new Error("plain");
      },
      "no-digest",
    );
    expect(result.success).toBe(false);
  });
});
