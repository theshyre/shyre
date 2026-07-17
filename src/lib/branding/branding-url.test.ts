import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isOwnBrandingUrl } from "./branding-url";

const SUPA = "https://proj.supabase.co";
const TEAM = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ownUrl = (team: string) =>
  `${SUPA}/storage/v1/object/public/branding/${team}/1700000000000.png`;

describe("isOwnBrandingUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("accepts a same-origin branding URL under the team's own folder", () => {
    expect(isOwnBrandingUrl(ownUrl(TEAM), TEAM)).toBe(true);
  });

  it("accepts a nested path (customer sub-folder) under the team folder", () => {
    expect(
      isOwnBrandingUrl(
        `${SUPA}/storage/v1/object/public/branding/${TEAM}/customers/x.png`,
        TEAM,
      ),
    ).toBe(true);
  });

  it("rejects another team's folder", () => {
    expect(isOwnBrandingUrl(ownUrl(OTHER), TEAM)).toBe(false);
  });

  it("rejects a different origin (off-site tracking pixel)", () => {
    expect(
      isOwnBrandingUrl(
        `https://evil.example/storage/v1/object/public/branding/${TEAM}/x.png`,
        TEAM,
      ),
    ).toBe(false);
  });

  it("rejects a non-branding bucket", () => {
    expect(
      isOwnBrandingUrl(
        `${SUPA}/storage/v1/object/public/avatars/${TEAM}/x.png`,
        TEAM,
      ),
    ).toBe(false);
  });

  it("rejects a malformed URL", () => {
    expect(isOwnBrandingUrl("not a url", TEAM)).toBe(false);
  });

  it("rejects when the env base is unset", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(isOwnBrandingUrl(ownUrl(TEAM), TEAM)).toBe(false);
  });
});
