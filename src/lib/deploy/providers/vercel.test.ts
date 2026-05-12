import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vercelProvider, VercelError } from "./vercel";

/**
 * Vercel driver — direct fetch (no SDK), so the tests just stub
 * `global.fetch` with a configurable response queue. Coverage:
 *
 *   - upsertEnvVar PATCH path when an existing key+target matches
 *   - upsertEnvVar POST path when nothing matches
 *   - upsertEnvVar matches by overlapping target set, not exact equality
 *   - triggerRedeploy posts to the deploy-hook URL; rejects when unset
 *   - readEnvVar exists vs not
 *   - teamSuffix appended to project endpoints when vercelTeamId is set
 *   - VercelError thrown on non-2xx, carries status + body
 *   - cfg validation (missing apiToken / projectId rejected at construction)
 */

let fetchSpy: ReturnType<typeof vi.fn>;

interface ResponseSpec {
  status: number;
  body?: unknown;
  bodyText?: string;
}

function queueResponses(...specs: ResponseSpec[]): void {
  let i = 0;
  fetchSpy.mockImplementation(
    async (
      _url: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      const spec = specs[i++];
      if (!spec) {
        throw new Error(
          `fetch called more times (${i}) than queued responses (${specs.length})`,
        );
      }
      const ok = spec.status >= 200 && spec.status < 300;
      return {
        ok,
        status: spec.status,
        json: async () => spec.body ?? {},
        text: async () => spec.bodyText ?? JSON.stringify(spec.body ?? {}),
      } as unknown as Response;
    },
  );
}

beforeEach(() => {
  fetchSpy = vi.fn();
  global.fetch = fetchSpy as unknown as typeof global.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vercelProvider construction", () => {
  it("throws when apiToken is missing", () => {
    expect(() =>
      vercelProvider({
        apiToken: "",
        projectId: "prj_1",
        vercelTeamId: null,
        deployHookUrl: null,
      }),
    ).toThrow(/API token/);
  });

  it("throws when projectId is missing", () => {
    expect(() =>
      vercelProvider({
        apiToken: "tok",
        projectId: "",
        vercelTeamId: null,
        deployHookUrl: null,
      }),
    ).toThrow(/project ID/);
  });
});

describe("upsertEnvVar", () => {
  it("POSTs a new env var when nothing matches", async () => {
    queueResponses(
      { status: 200, body: { envs: [] } }, // listEnvVars
      { status: 200, body: { id: "env_new" } }, // POST
    );
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    const result = await drv.upsertEnvVar({
      key: "MY_KEY",
      value: "secret",
      targets: ["production"],
    });
    expect(result).toEqual({ envVarId: "env_new", created: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const postCall = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(postCall[0]).toContain(
      "https://api.vercel.com/v9/projects/prj_1/env",
    );
    expect(postCall[1]?.method).toBe("POST");
    const body = JSON.parse(postCall[1]?.body as string);
    expect(body).toEqual({
      key: "MY_KEY",
      value: "secret",
      target: ["production"],
      type: "encrypted",
    });
  });

  it("PATCHes existing env var when key + overlapping target matches", async () => {
    queueResponses(
      {
        status: 200,
        body: {
          envs: [
            {
              id: "env_existing",
              key: "MY_KEY",
              type: "encrypted",
              target: ["production", "preview"],
            },
          ],
        },
      },
      { status: 200, body: { id: "env_existing" } }, // PATCH
    );
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    const result = await drv.upsertEnvVar({
      key: "MY_KEY",
      value: "new_secret",
      targets: ["production"],
    });
    expect(result).toEqual({ envVarId: "env_existing", created: false });
    const patchCall = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(patchCall[0]).toContain(
      "/v9/projects/prj_1/env/env_existing",
    );
    expect(patchCall[1]?.method).toBe("PATCH");
    const body = JSON.parse(patchCall[1]?.body as string);
    expect(body.value).toBe("new_secret");
    // Targets are preserved from the existing row, not from input.
    expect(body.target).toEqual(["production", "preview"]);
  });

  it("PATCHes EVERY matching row when multiple keys overlap", async () => {
    queueResponses(
      {
        status: 200,
        body: {
          envs: [
            {
              id: "env_a",
              key: "MY_KEY",
              type: "encrypted",
              target: ["production"],
            },
            {
              id: "env_b",
              key: "MY_KEY",
              type: "encrypted",
              target: ["preview"],
            },
            {
              id: "env_c",
              key: "OTHER_KEY",
              type: "encrypted",
              target: ["production"],
            },
          ],
        },
      },
      { status: 200, body: {} },
      { status: 200, body: {} },
    );
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    await drv.upsertEnvVar({
      key: "MY_KEY",
      value: "v",
      targets: ["production", "preview"],
    });
    // 1 list + 2 PATCHes (matching MY_KEY rows; OTHER_KEY ignored).
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("uses type=plain when encrypt=false is passed", async () => {
    queueResponses(
      { status: 200, body: { envs: [] } },
      { status: 200, body: { id: "env_plain" } },
    );
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    await drv.upsertEnvVar({
      key: "PUB_FLAG",
      value: "1",
      targets: ["production"],
      encrypt: false,
    });
    const body = JSON.parse(
      (fetchSpy.mock.calls[1] as [string, RequestInit])[1]?.body as string,
    );
    expect(body.type).toBe("plain");
  });

  it("appends ?teamId=… when vercelTeamId is configured", async () => {
    queueResponses(
      { status: 200, body: { envs: [] } },
      { status: 200, body: { id: "e" } },
    );
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: "team_acme",
      deployHookUrl: null,
    });
    await drv.upsertEnvVar({
      key: "X",
      value: "v",
      targets: ["production"],
    });
    expect((fetchSpy.mock.calls[0] as [string, RequestInit])[0]).toContain(
      "?teamId=team_acme",
    );
  });

  it("throws VercelError with status + body on non-2xx response", async () => {
    queueResponses({
      status: 403,
      bodyText: "forbidden — bad token",
    });
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    await expect(
      drv.upsertEnvVar({
        key: "X",
        value: "v",
        targets: ["production"],
      }),
    ).rejects.toBeInstanceOf(VercelError);
  });
});

describe("triggerRedeploy", () => {
  it("rejects when deployHookUrl is not configured", async () => {
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    await expect(drv.triggerRedeploy()).rejects.toThrow(
      /Deploy hook URL is not configured/,
    );
  });

  it("POSTs to the deploy hook URL on success; returns the job id", async () => {
    queueResponses({
      status: 200,
      body: { job: { id: "dep_abc123" } },
    });
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: "https://api.vercel.com/v1/integrations/deploy/abc",
    });
    const result = await drv.triggerRedeploy();
    expect(result.deploymentId).toBe("dep_abc123");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.vercel.com/v1/integrations/deploy/abc",
      { method: "POST" },
    );
  });

  it("returns an empty object when the deploy hook responds but has no job id", async () => {
    queueResponses({ status: 200, body: {} });
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: "https://example.com/hook",
    });
    const result = await drv.triggerRedeploy();
    expect(result).toEqual({});
  });

  it("rejects when the deploy hook returns non-2xx", async () => {
    queueResponses({ status: 500, bodyText: "internal error" });
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: "https://example.com/hook",
    });
    await expect(drv.triggerRedeploy()).rejects.toThrow(/500/);
  });
});

describe("readEnvVar", () => {
  it("returns exists=false when the key is not present", async () => {
    queueResponses({ status: 200, body: { envs: [] } });
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    expect(await drv.readEnvVar!("MISSING")).toEqual({
      exists: false,
      value: null,
    });
  });

  it("returns exists=true with the value when found", async () => {
    queueResponses({
      status: 200,
      body: {
        envs: [
          {
            id: "e1",
            key: "MY_KEY",
            value: "v",
            type: "encrypted",
            target: ["production"],
          },
        ],
      },
    });
    const drv = vercelProvider({
      apiToken: "tok",
      projectId: "prj_1",
      vercelTeamId: null,
      deployHookUrl: null,
    });
    expect(await drv.readEnvVar!("MY_KEY")).toEqual({
      exists: true,
      value: "v",
    });
  });
});

describe("VercelError", () => {
  it("carries the status, body, and path; message truncates long bodies", () => {
    const err = new VercelError(403, "x".repeat(500), "/v9/projects/p/env");
    expect(err.status).toBe(403);
    expect(err.path).toBe("/v9/projects/p/env");
    expect(err.message).toContain("403");
    // Truncated to ~200 chars to keep the error log readable.
    expect(err.message.length).toBeLessThan(300);
  });
});
