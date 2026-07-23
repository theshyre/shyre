import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";

import {
  toToolResult,
  tokenHashFromAuthInfo,
  verifyIntegrationBearer,
  type McpToolResult,
} from "@/lib/integrations/mcp-auth";
import {
  deleteEntry,
  getEntry,
  getTimer,
  listEntries,
  listProjects,
  logEntry,
  startTimer,
  stopTimer,
  updateEntry,
  type ServiceResult,
} from "@/lib/integrations/service";

/**
 * MCP endpoint — https://<host>/api/mcp (SAL-051).
 *
 * Streamable-HTTP only (SSE is deprecated in the MCP spec and disabled
 * here). mcp-handler matches `pathname === basePath + "/mcp"` exactly,
 * so this file lives at app/api/mcp/route.ts (a static segment) with
 * basePath "/api" — the documented client URL:
 *
 *   claude mcp add --transport http shyre https://shyre.malcom.io/api/mcp \
 *     --header "Authorization: Bearer ${SHYRE_API_KEY}"
 *
 * Auth: `withMcpAuth` + `verifyIntegrationBearer` — the same PAT, the
 * same `api_whoami` gauntlet, the same audit trail as /api/v1. Tools
 * call the SAME service functions as the REST routes, so the two
 * transports cannot drift.
 */

const SESSION_REF_DESC =
  "Optional stable reference for this agent session (e.g. the Claude Code session id) — stored as provenance on the entry.";

async function runTool(
  extra: { authInfo?: Parameters<typeof tokenHashFromAuthInfo>[0] },
  action: string,
  invoke: (tokenHash: string) => Promise<ServiceResult>,
): Promise<McpToolResult> {
  const tokenHash = tokenHashFromAuthInfo(extra.authInfo);
  if (!tokenHash) {
    // withMcpAuth (required: true) should make this unreachable, but a
    // missing hash must fail closed, uniformly.
    return toToolResult(
      { ok: false, status: 401, error: "unauthorized", message: "missing auth info" },
      { action },
    );
  }
  return toToolResult(await invoke(tokenHash), { action });
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "get_current_timer",
      "Get the currently running Shyre timer for the token's user, or null when nothing is running. Check this before starting a timer.",
      {},
      (_args, extra) =>
        runTool(extra, "api.mcp.get_current_timer", (tokenHash) => getTimer(tokenHash)),
    );

    server.tool(
      "list_projects",
      "List the active and paused Shyre projects (id, name, status, customer) available for time tracking. Use a project id from here for start_timer and log_time_entry.",
      {},
      (_args, extra) =>
        runTool(extra, "api.mcp.list_projects", (tokenHash) => listProjects(tokenHash)),
    );

    server.tool(
      "start_timer",
      "Start a live Shyre timer on a project. NOTE: this fails with a conflict (409) if ANY timer is already running — it never displaces the human's timer. For work that is already finished, prefer log_time_entry instead of start/stop.",
      {
        project_id: z.uuid().describe("Project id (from list_projects)."),
        description: z
          .string()
          .max(2000)
          .optional()
          .describe("What is being worked on. Can be upgraded at stop time."),
        agent_label: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe("Label for the acting agent. Defaults to 'Claude Code'."),
        session_ref: z.string().min(1).max(256).optional().describe(SESSION_REF_DESC),
        idempotency_key: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe("Retry-dedupe key: replays return the original entry."),
      },
      (args, extra) =>
        runTool(extra, "api.mcp.start_timer", (tokenHash) =>
          startTimer(tokenHash, {
            projectId: args.project_id,
            description: args.description,
            agentLabel: args.agent_label,
            sessionRef: args.session_ref,
            idempotencyKey: args.idempotency_key,
          }),
        ),
    );

    server.tool(
      "stop_timer",
      "Stop the running Shyre timer. Only stops an agent-started timer unless force is true (a human's timer is never silently stopped). Pass a description summarizing the outcome — it upgrades the entry.",
      {
        description: z
          .string()
          .max(2000)
          .optional()
          .describe("Outcome summary to store on the completed entry."),
        force: z
          .boolean()
          .optional()
          .describe(
            "Also stop a HUMAN-started timer. Only use when the user explicitly asked to stop their timer.",
          ),
      },
      (args, extra) =>
        runTool(extra, "api.mcp.stop_timer", (tokenHash) =>
          stopTimer(tokenHash, {
            description: args.description,
            force: args.force,
          }),
        ),
    );

    server.tool(
      "log_time_entry",
      "PREFERRED way to record work in Shyre: log a completed block of time after the work is done (no orphaned timers, no idle inflation). Requires a meaningful description (>= 8 chars) of what was accomplished. The range must be <= 24h, not in the future, not dated in a locked accounting period (403), and must not overlap the user's existing entries on the same project (conflict 409 otherwise). There is no fixed backdating window — backfills are accepted up to 1 year back. Recommended: call this once when a work session completes.",
      {
        project_id: z.uuid().describe("Project id (from list_projects)."),
        start_time: z
          .iso
          .datetime({ offset: true })
          .describe("Work start, ISO 8601 with timezone (e.g. 2026-07-18T14:00:00Z)."),
        end_time: z
          .iso
          .datetime({ offset: true })
          .describe("Work end, ISO 8601 with timezone."),
        description: z
          .string()
          .min(1)
          .max(2000)
          .describe("What was accomplished — outcome-quality, >= 8 chars."),
        agent_label: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .describe("Label for the acting agent. Defaults to 'Claude Code'."),
        session_ref: z.string().min(1).max(256).optional().describe(SESSION_REF_DESC),
        idempotency_key: z
          .string()
          .min(1)
          .max(128)
          .optional()
          .describe("Retry-dedupe key: replays return the original entry."),
        billable: z
          .boolean()
          .optional()
          .describe("Override the token's default billable flag."),
        category_id: z
          .uuid()
          .optional()
          .describe(
            "Category id (from list_projects' `categories`). Omit to use the project's default category.",
          ),
      },
      (args, extra) =>
        runTool(extra, "api.mcp.log_time_entry", (tokenHash) =>
          logEntry(tokenHash, {
            projectId: args.project_id,
            startTime: args.start_time,
            endTime: args.end_time,
            description: args.description,
            agentLabel: args.agent_label,
            sessionRef: args.session_ref,
            idempotencyKey: args.idempotency_key,
            billable: args.billable,
            categoryId: args.category_id,
          }),
        ),
    );

    server.tool(
      "list_time_entries",
      "List the token user's own recent time entries (newest first) so you can find one to edit or delete. Optional: project_id (uuid), limit (1-100, default 20), since (ISO 8601). Each row includes `started_by_kind` — you may only update/delete rows where it is 'agent' (entries you logged), never human-entered time.",
      {
        project_id: z.uuid().optional().describe("Filter to one project (from list_projects)."),
        limit: z.number().int().min(1).max(100).optional().describe("Max rows (1-100, default 20)."),
        since: z
          .iso
          .datetime({ offset: true })
          .optional()
          .describe("Only entries starting at/after this ISO 8601 instant."),
      },
      (args, extra) =>
        runTool(extra, "api.mcp.list_time_entries", (tokenHash) =>
          listEntries(tokenHash, {
            projectId: args.project_id,
            limit: args.limit,
            since: args.since,
          }),
        ),
    );

    server.tool(
      "get_time_entry",
      "Fetch one of the token user's time entries by id (full row).",
      { entry_id: z.uuid().describe("Entry id (from list_time_entries or a log response).") },
      (args, extra) =>
        runTool(extra, "api.mcp.get_time_entry", (tokenHash) =>
          getEntry(tokenHash, args.entry_id),
        ),
    );

    server.tool(
      "update_time_entry",
      "Edit one of YOUR OWN agent-logged entries (started_by_kind='agent') to fix a mistake — trim the duration, backfill a category, correct the description or billable flag. Only the fields you pass change. Refused (403) for human-entered entries, (409) for invoiced ones, and (403) inside a locked accounting period. Editing the description does NOT re-run ticket auto-linking. Cannot move an entry to a different project.",
      {
        entry_id: z.uuid().describe("Entry id (from list_time_entries)."),
        start_time: z.iso.datetime({ offset: true }).optional().describe("New start, ISO 8601 with timezone."),
        end_time: z.iso.datetime({ offset: true }).optional().describe("New end, ISO 8601 with timezone."),
        description: z.string().min(1).max(2000).optional().describe("New description (>= 8 meaningful chars)."),
        category_id: z.uuid().optional().describe("New category id (must belong to the project's effective set)."),
        billable: z.boolean().optional().describe("New billable flag (forced false on internal projects)."),
      },
      (args, extra) =>
        runTool(extra, "api.mcp.update_time_entry", (tokenHash) =>
          updateEntry(tokenHash, args.entry_id, {
            startTime: args.start_time,
            endTime: args.end_time,
            description: args.description,
            categoryId: args.category_id,
            billable: args.billable,
          }),
        ),
    );

    server.tool(
      "delete_time_entry",
      "Soft-delete one of YOUR OWN agent-logged entries (recoverable from Trash in the app). Use for a stray/duplicate entry you created. Refused (403) for human-entered entries, (409) for invoiced ones, and (403) inside a locked accounting period.",
      { entry_id: z.uuid().describe("Entry id (from list_time_entries).") },
      (args, extra) =>
        runTool(extra, "api.mcp.delete_time_entry", (tokenHash) =>
          deleteEntry(tokenHash, args.entry_id),
        ),
    );
  },
  {
    serverInfo: { name: "shyre", version: "1.0.0" },
  },
  {
    basePath: "/api",
    maxDuration: 60,
    disableSse: true,
    verboseLogs: false,
  },
);

const authedHandler = withMcpAuth(handler, verifyIntegrationBearer, {
  required: true,
});

export const runtime = "nodejs";
export const maxDuration = 60;

export {
  authedHandler as GET,
  authedHandler as POST,
  authedHandler as DELETE,
};
