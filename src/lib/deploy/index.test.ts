import { describe, it, expect, vi } from "vitest";

const { vercelProviderMock } = vi.hoisted(() => ({
  vercelProviderMock: vi.fn(() => ({ tag: "vercel-driver" })),
}));
vi.mock("./providers/vercel", () => ({
  vercelProvider: vercelProviderMock,
}));

import { deployProviderFor } from "./index";

describe("deployProviderFor", () => {
  it("returns the vercel driver for provider='vercel'", () => {
    const cfg = {
      apiToken: "t",
      projectId: "p",
      vercelTeamId: null,
      deployHookUrl: null,
    };
    const drv = deployProviderFor("vercel", cfg);
    expect(vercelProviderMock).toHaveBeenCalledWith(cfg);
    expect(drv).toEqual({ tag: "vercel-driver" });
  });

  it("throws on an unknown provider id (exhaustiveness sentinel)", () => {
    expect(() =>
      // @ts-expect-error — deliberately wrong provider id
      deployProviderFor("aws-amplify", {
        apiToken: "t",
        projectId: "p",
        vercelTeamId: null,
        deployHookUrl: null,
      }),
    ).toThrow(/Unsupported deploy provider/);
  });
});
