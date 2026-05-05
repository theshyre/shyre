import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isOwnSupabaseAvatarUrl } from "./avatar-url-validator";

const BASE = "https://demo.supabase.co";

describe("isOwnSupabaseAvatarUrl", () => {
  const originalEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnv;
  });

  it("accepts a same-origin avatars URL nested under the caller's userId", () => {
    const url = `${BASE}/storage/v1/object/public/avatars/user-123/2026.png`;
    expect(isOwnSupabaseAvatarUrl(url, "user-123")).toBe(true);
  });

  it("rejects a same-origin avatars URL under a different userId", () => {
    const url = `${BASE}/storage/v1/object/public/avatars/other-user/2026.png`;
    expect(isOwnSupabaseAvatarUrl(url, "user-123")).toBe(false);
  });

  it("rejects an external host even if it claims to be an avatars URL", () => {
    const url = "https://evil.test/storage/v1/object/public/avatars/user-123/x.png";
    expect(isOwnSupabaseAvatarUrl(url, "user-123")).toBe(false);
  });

  it("rejects when the bucket is not `avatars`", () => {
    const url = `${BASE}/storage/v1/object/public/uploads/user-123/x.png`;
    expect(isOwnSupabaseAvatarUrl(url, "user-123")).toBe(false);
  });

  it("rejects malformed URL strings", () => {
    expect(isOwnSupabaseAvatarUrl("not a url", "user-123")).toBe(false);
    expect(isOwnSupabaseAvatarUrl("", "user-123")).toBe(false);
  });

  it("rejects when NEXT_PUBLIC_SUPABASE_URL is unset", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const url = `${BASE}/storage/v1/object/public/avatars/user-123/x.png`;
    expect(isOwnSupabaseAvatarUrl(url, "user-123")).toBe(false);
  });

  it("rejects path-traversal that exits the user's folder", () => {
    // The URL constructor normalizes `..` segments before pathname is
    // read, so `avatars/user-123/../other/x.png` resolves to
    // `avatars/other/x.png`. The function compares exact segments and
    // correctly refuses — the post-normalization path is no longer
    // under the caller's userId.
    const traversal = `${BASE}/storage/v1/object/public/avatars/user-123/../other/x.png`;
    expect(isOwnSupabaseAvatarUrl(traversal, "user-123")).toBe(false);
  });

  it("rejects a similar bucket name that contains 'avatars' as a substring", () => {
    const wrong = `${BASE}/storage/v1/object/public/avatars2/user-123/x.png`;
    expect(isOwnSupabaseAvatarUrl(wrong, "user-123")).toBe(false);
  });
});
