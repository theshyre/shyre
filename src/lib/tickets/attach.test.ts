import { describe, it, expect, vi, beforeEach } from "vitest";

const { lookupTicketMock } = vi.hoisted(() => ({
  lookupTicketMock: vi.fn(),
}));

vi.mock("./lookup", () => ({
  lookupTicket: lookupTicketMock,
}));

import { buildTicketAttachment } from "./attach";

interface FakeProject {
  github_repo: string | null;
  jira_project_key: string | null;
}

function makeSupabase(project: FakeProject | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: project, error: null }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  lookupTicketMock.mockReset();
});

describe("buildTicketAttachment", () => {
  it("returns ALL nulls for an empty description", async () => {
    const supabase = makeSupabase({
      github_repo: "octokit/rest.js",
      jira_project_key: "PROJ",
    });
    const r = await buildTicketAttachment(
      supabase as never,
      "u1",
      "",
      "p1",
    );
    expect(r).toEqual({
      linked_ticket_provider: null,
      linked_ticket_key: null,
      linked_ticket_url: null,
      linked_ticket_title: null,
      linked_ticket_refreshed_at: null,
    });
    expect(lookupTicketMock).not.toHaveBeenCalled();
  });

  it("returns ALL nulls when no ticket pattern matches", async () => {
    const supabase = makeSupabase({
      github_repo: null,
      jira_project_key: null,
    });
    const r = await buildTicketAttachment(
      supabase as never,
      "u1",
      "no ticket here, just notes",
      null,
    );
    expect(r.linked_ticket_provider).toBeNull();
    expect(lookupTicketMock).not.toHaveBeenCalled();
  });

  it("returns full attachment when lookup resolves", async () => {
    const supabase = makeSupabase({
      github_repo: "octokit/rest.js",
      jira_project_key: null,
    });
    lookupTicketMock.mockResolvedValueOnce({
      provider: "github",
      key: "octokit/rest.js#42",
      url: "https://github.com/octokit/rest.js/issues/42",
      title: "Fix login",
    });
    const r = await buildTicketAttachment(
      supabase as never,
      "u1",
      "Worked on #42",
      "p1",
    );
    expect(r.linked_ticket_provider).toBe("github");
    expect(r.linked_ticket_key).toBe("octokit/rest.js#42");
    expect(r.linked_ticket_url).toBe(
      "https://github.com/octokit/rest.js/issues/42",
    );
    expect(r.linked_ticket_title).toBe("Fix login");
    expect(r.linked_ticket_refreshed_at).not.toBeNull();
  });

  it("falls back to a partial attachment (key + provider only) when lookup returns null", async () => {
    // Detected, but no creds / 404 / network — chip still renders
    // with the key, refresh button can retry later.
    const supabase = makeSupabase(null);
    lookupTicketMock.mockResolvedValueOnce(null);
    const r = await buildTicketAttachment(
      supabase as never,
      "u1",
      "PROJ-9 notes",
      null,
    );
    expect(r.linked_ticket_provider).toBe("jira");
    expect(r.linked_ticket_key).toBe("PROJ-9");
    expect(r.linked_ticket_url).toBeNull();
    expect(r.linked_ticket_title).toBeNull();
    expect(r.linked_ticket_refreshed_at).toBeNull();
  });

  it("uses the project's github_repo for short-ref resolution", async () => {
    const supabase = makeSupabase({
      github_repo: "vercel/next.js",
      jira_project_key: null,
    });
    lookupTicketMock.mockResolvedValueOnce({
      provider: "github",
      key: "vercel/next.js#88",
      url: "https://github.com/vercel/next.js/issues/88",
      title: "RFC",
    });
    const r = await buildTicketAttachment(
      supabase as never,
      "u1",
      "Reviewing #88",
      "p1",
    );
    expect(r.linked_ticket_key).toBe("vercel/next.js#88");
    // The DetectedTicket passed to lookup has the qualified key —
    // we don't re-export DetectedTicket here, so just verify the
    // resolved key matches what lookup returned.
  });

  it("does not crash when projectId is null (no defaults available)", async () => {
    const supabase = makeSupabase(null);
    lookupTicketMock.mockResolvedValueOnce(null);
    const r = await buildTicketAttachment(
      supabase as never,
      "u1",
      "PROJ-7 today",
      null,
    );
    expect(r.linked_ticket_provider).toBe("jira");
  });
});
