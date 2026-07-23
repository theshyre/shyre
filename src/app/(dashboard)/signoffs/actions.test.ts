import { describe, it, expect, vi, beforeEach } from "vitest";

// Strip the auth boundary (safe-action.test.ts covers the wrapper); let errors
// propagate so tests can assert on them.
vi.mock("@/lib/safe-action", () => ({
  runSafeAction: async (
    formData: FormData,
    fn: (fd: FormData, ctx: { supabase: unknown; userId: string }) => Promise<void>,
  ) => {
    await fn(formData, { supabase: supabaseStub, userId: "u-author" });
    return { success: true };
  },
}));

const mockRequireTeamAdmin = vi.fn();
vi.mock("@/lib/team-context", () => ({
  requireTeamAdmin: (...args: unknown[]) => mockRequireTeamAdmin(...args),
}));

const mockRevalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => mockRevalidatePath(p) }));

const mockRedirect = vi.fn((path: string): never => {
  throw new Error(`NEXT_REDIRECT ${path}`);
});
vi.mock("next/navigation", () => ({ redirect: (path: string) => mockRedirect(path) }));

interface Result { data: unknown; error: unknown; }
interface Call { table: string; ops: Array<{ method: string; args: unknown[] }>; }
let queues: Record<string, Result[]> = {};
let calls: Call[] = [];

interface Builder extends PromiseLike<Result> {
  select: (c?: string) => Builder;
  eq: (c: string, v: unknown) => Builder;
  maybeSingle: () => Promise<Result>;
  single: () => Promise<Result>;
  insert: (r: unknown) => Builder;
  update: (p: unknown) => Builder;
  delete: () => Builder;
}
function makeBuilder(table: string): Builder {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const resolve = (): Result => queues[table]?.shift() ?? { data: null, error: null };
  const b: Builder = {
    select: (...a) => { call.ops.push({ method: "select", args: a }); return b; },
    eq: (...a) => { call.ops.push({ method: "eq", args: a }); return b; },
    insert: (...a) => { call.ops.push({ method: "insert", args: a }); return b; },
    update: (...a) => { call.ops.push({ method: "update", args: a }); return b; },
    delete: (...a) => { call.ops.push({ method: "delete", args: a }); return b; },
    single: () => Promise.resolve(resolve()),
    maybeSingle: () => Promise.resolve(resolve()),
    then: (f, r) => Promise.resolve(resolve()).then(f, r),
  };
  return b;
}
const supabaseStub = { from: (t: string) => makeBuilder(t) };

import {
  createSignoffAction,
  updateSignoffDraftAction,
  deleteSignoffAction,
} from "./actions";

const TEAM = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function form(payload: Record<string, unknown>, extra?: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set("payload", JSON.stringify(payload));
  for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
  return fd;
}
function inserted(table: string): Record<string, unknown> {
  const c = calls.find((x) => x.table === table && x.ops.some((o) => o.method === "insert"));
  const op = c?.ops.find((o) => o.method === "insert");
  return (Array.isArray(op?.args[0]) ? op!.args[0]![0] : op?.args[0]) as Record<string, unknown>;
}

beforeEach(() => {
  queues = {};
  calls = [];
  mockRequireTeamAdmin.mockReset().mockResolvedValue({ userId: "u-author", role: "owner" });
  mockRevalidatePath.mockClear();
  mockRedirect.mockClear();
});

describe("createSignoffAction", () => {
  it("inserts the document + roster, then redirects to the detail page", async () => {
    queues["signoff_documents"] = [{ data: { id: "doc-1" }, error: null }];
    await expect(
      createSignoffAction(
        form({
          team_id: TEAM,
          title: "Release Notes v2.0.2",
          version_label: "v2.0.2",
          body_markdown: "# Notes",
          signers: [
            { name: "Bret Andre", email: "Bandre@FDApproval.com", roleLabel: "Principal Consultant", orgLabel: "EyeReg" },
          ],
        }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT \/signoffs\/doc-1/);

    expect(mockRequireTeamAdmin).toHaveBeenCalledWith(TEAM);
    expect(inserted("signoff_documents")).toMatchObject({
      team_id: TEAM,
      title: "Release Notes v2.0.2",
      document_type: "release_notes",
    });
    // Signer email is lowercased.
    expect(inserted("signoff_signers")).toMatchObject({
      email: "bandre@fdapproval.com",
      name: "Bret Andre",
      role_label: "Principal Consultant",
    });
  });

  it("refuses a customer that isn't on the team", async () => {
    queues["customers"] = [{ data: null, error: null }]; // not found
    await expect(
      createSignoffAction(
        form({ team_id: TEAM, customer_id: "3fa85f64-5717-4562-b3fc-2c963f66afa7", title: "X" }),
      ),
    ).rejects.toThrow(/customer isn't on the selected team/i);
  });

  it("rejects a malformed payload", async () => {
    const fd = new FormData();
    fd.set("payload", "not json");
    await expect(createSignoffAction(fd)).rejects.toThrow(/Malformed/i);
  });
});

describe("updateSignoffDraftAction", () => {
  it("updates a draft's content + roster", async () => {
    queues["signoff_documents"] = [{ data: { id: "doc-1", status: "draft", team_id: TEAM }, error: null }];
    await updateSignoffDraftAction(
      form({ team_id: TEAM, title: "Edited", body_markdown: "# B", signers: [] }, { document_id: "doc-1" }),
    );
    const upd = calls.find((c) => c.table === "signoff_documents" && c.ops.some((o) => o.method === "update"));
    expect(upd).toBeDefined();
    expect(mockRevalidatePath).toHaveBeenCalledWith("/signoffs/doc-1");
  });

  it("refuses editing a sent (frozen) sign-off", async () => {
    queues["signoff_documents"] = [{ data: { id: "doc-1", status: "sent", team_id: TEAM }, error: null }];
    await expect(
      updateSignoffDraftAction(form({ team_id: TEAM, title: "X" }, { document_id: "doc-1" })),
    ).rejects.toThrow(/frozen/i);
  });
});

describe("deleteSignoffAction", () => {
  it("hard-deletes a draft", async () => {
    queues["signoff_documents"] = [{ data: { status: "draft", team_id: TEAM }, error: null }];
    await deleteSignoffAction(form({ team_id: TEAM }, { document_id: "doc-1" }));
    const del = calls.find((c) => c.table === "signoff_documents" && c.ops.some((o) => o.method === "delete"));
    expect(del).toBeDefined();
    expect(mockRequireTeamAdmin).toHaveBeenCalledWith(TEAM);
  });

  it("refuses deleting a sent sign-off (audit record)", async () => {
    queues["signoff_documents"] = [{ data: { status: "completed", team_id: TEAM }, error: null }];
    await expect(
      deleteSignoffAction(form({ team_id: TEAM }, { document_id: "doc-1" })),
    ).rejects.toThrow(/audit record/i);
  });
});
