import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { redactPat } from "./tokens";

/**
 * Integration service layer (SAL-051).
 *
 * The ONLY bridge between the session-less integration surface (REST
 * /api/v1 + MCP /api/mcp) and the database. Every function calls one of
 * the six SECURITY DEFINER RPCs from `20260718150000_integrations_foundation.sql`
 * through a bare ANON client — no cookies, no session, no service role.
 * Authorization lives entirely inside `api_resolve_token` (revocation,
 * expiry, live membership, team kill switch, scope, rate window), keyed
 * by the sha256 hash of the caller's PAT.
 *
 * Both the REST routes and the MCP tools consume these functions, so
 * behavior (validation, audit rows, error codes) can never drift
 * between the two transports.
 */

export type IntegrationErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal";

export interface ServiceFailure {
  ok: false;
  /** HTTP status the REST layer should return. */
  status: number;
  /** Stable machine-readable code — the response envelope's `error`. */
  error: IntegrationErrorCode;
  /**
   * Diagnostic message, already PAT-redacted. Safe for logError and for
   * the 409 response body (agents need to know WHY a write was refused);
   * never surfaced on 401 (uniform body — no oracle).
   */
  message: string;
}

export interface ServiceSuccess {
  ok: true;
  /** The RPC's JSONB result, passed through verbatim. */
  data: unknown;
}

export type ServiceResult = ServiceSuccess | ServiceFailure;

/**
 * Postgres ERRCODE → transport mapping. The RPCs RAISE with TK4xx codes;
 * TK001/TK002 come from the immutability triggers and would indicate an
 * RPC bug (they never fire on the insert paths), so they fall through to
 * 500 like any other unexpected code.
 */
const ERRCODE_MAP: Record<string, { status: number; error: IntegrationErrorCode }> = {
  TK400: { status: 400, error: "invalid_request" },
  TK401: { status: 401, error: "unauthorized" },
  TK403: { status: 403, error: "forbidden" },
  TK404: { status: 404, error: "not_found" },
  TK409: { status: 409, error: "conflict" },
  TK429: { status: 429, error: "rate_limited" },
};

/**
 * Bare anon client — deliberately NOT the cookie-bound client from
 * `@/lib/supabase/server`. The integration surface has no browser
 * session; auth is the token hash argument, enforced inside the
 * SECURITY DEFINER RPCs. Everything the anon role can reach is the six
 * granted `api_*` functions.
 */
export function createIntegrationClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    const missing = [
      !url && "NEXT_PUBLIC_SUPABASE_URL",
      !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]
      .filter(Boolean)
      .join(", ");
    throw new Error(`Missing required env var(s): ${missing}`);
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Strip undefined values so PostgREST applies the SQL parameter
 * defaults (e.g. `p_agent_label DEFAULT 'Claude Code'`) instead of
 * receiving an explicit NULL.
 */
function compact(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined),
  );
}

async function callRpc(
  fn: string,
  params: Record<string, unknown>,
): Promise<ServiceResult> {
  try {
    const supabase = createIntegrationClient();
    const { data, error } = await supabase.rpc(fn, compact(params));
    if (error) {
      const mapped = typeof error.code === "string" ? ERRCODE_MAP[error.code] : undefined;
      const message = redactPat(error.message ?? `rpc ${fn} failed`);
      if (mapped) return { ok: false, ...mapped, message };
      return { ok: false, status: 500, error: "internal", message };
    }
    return { ok: true, data: data ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : `rpc ${fn} threw`;
    return { ok: false, status: 500, error: "internal", message: redactPat(message) };
  }
}

export interface StartTimerInput {
  projectId: string;
  description?: string;
  agentLabel?: string;
  sessionRef?: string;
  idempotencyKey?: string;
}

export interface StopTimerInput {
  description?: string;
  force?: boolean;
}

export interface LogEntryInput {
  projectId: string;
  startTime: string;
  endTime: string;
  description: string;
  agentLabel?: string;
  sessionRef?: string;
  idempotencyKey?: string;
  billable?: boolean;
  /** Optional category (id from `list_projects` → `categories[]`). When
   *  omitted the RPC falls back to the project's `default_category_id`. */
  categoryId?: string;
}

export function whoami(tokenHash: string): Promise<ServiceResult> {
  return callRpc("api_whoami", { p_token_hash: tokenHash });
}

export function listProjects(tokenHash: string): Promise<ServiceResult> {
  return callRpc("api_list_projects", { p_token_hash: tokenHash });
}

export function getTimer(tokenHash: string): Promise<ServiceResult> {
  return callRpc("api_get_timer", { p_token_hash: tokenHash });
}

export function startTimer(
  tokenHash: string,
  input: StartTimerInput,
): Promise<ServiceResult> {
  return callRpc("api_start_timer", {
    p_token_hash: tokenHash,
    p_project_id: input.projectId,
    p_description: input.description,
    p_agent_label: input.agentLabel,
    p_session_ref: input.sessionRef,
    p_idem_key: input.idempotencyKey,
  });
}

export function stopTimer(
  tokenHash: string,
  input: StopTimerInput,
): Promise<ServiceResult> {
  return callRpc("api_stop_timer", {
    p_token_hash: tokenHash,
    p_description: input.description,
    p_force: input.force,
  });
}

export function logEntry(
  tokenHash: string,
  input: LogEntryInput,
): Promise<ServiceResult> {
  return callRpc("api_log_entry", {
    p_token_hash: tokenHash,
    p_project_id: input.projectId,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    p_description: input.description,
    p_agent_label: input.agentLabel,
    p_session_ref: input.sessionRef,
    p_idem_key: input.idempotencyKey,
    p_billable: input.billable,
    p_category_id: input.categoryId,
  });
}
