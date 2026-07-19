import "server-only";

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { AppError } from "@/lib/errors";
import { logError } from "@/lib/logger";

import { logIntegrationFailure } from "./api-auth";
import { whoami, type ServiceResult } from "./service";
import { TOKEN_PREFIX, extractBearerPat, redactPat, sha256Hex } from "./tokens";

/**
 * Bearer-PAT verification for the MCP endpoint (SAL-051).
 *
 * Same trust chain as the REST wrapper: Authorization header only,
 * sha256 immediately, then `api_whoami` — which runs the full
 * `api_resolve_token` gauntlet (revocation, expiry, live membership,
 * team kill switch, scope, rate window). Returning `undefined` makes
 * `withMcpAuth` answer 401; the reason stays in the audit trail, never
 * in the response (no oracle).
 *
 * On success the token HASH (never the raw PAT) rides on
 * `authInfo.extra.tokenHash` so every tool reuses it without re-reading
 * the header.
 */

export interface McpAuthExtra {
  tokenHash: string;
  whoami: unknown;
  [key: string]: unknown;
}

export async function verifyIntegrationBearer(
  req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  const url = req.url;
  const authorization =
    bearerToken !== undefined
      ? `Bearer ${bearerToken}`
      : req.headers.get("authorization");
  const pat = extractBearerPat(authorization);
  if (!pat) {
    logError(
      new AppError({
        code: "AUTH_UNAUTHORIZED",
        message: "MCP request without a well-formed bearer PAT",
        userMessageKey: "errors.authUnauthorized",
        // "info" = not persisted (logger drops info): a request with NO
        // Authorization header at all is scanner/browser noise with zero
        // forensic value — it was landing an unresolved warning per hit.
        // Token-SHAPED but invalid attempts (the brute-force signal) still
        // log at warning via the invalid-token path.
        severity: "info",
      }),
      { url, action: "api.mcp.auth" },
    );
    return undefined;
  }

  const tokenHash = sha256Hex(pat);
  const result = await whoami(tokenHash);
  if (!result.ok) {
    logIntegrationFailure(result, {
      url,
      action: "api.mcp.auth",
      tokenPrefix: pat.slice(0, TOKEN_PREFIX.length + 6),
    });
    return undefined;
  }

  const identity =
    result.data && typeof result.data === "object"
      ? (result.data as { user_id?: unknown; scopes?: unknown })
      : {};
  return {
    // The raw PAT must not ride on authInfo (it would be one
    // console.log away from a transcript) — the hash is sufficient for
    // every downstream call.
    token: tokenHash,
    clientId: typeof identity.user_id === "string" ? identity.user_id : "unknown",
    scopes: Array.isArray(identity.scopes)
      ? identity.scopes.filter((s): s is string => typeof s === "string")
      : [],
    extra: { tokenHash, whoami: result.data } satisfies McpAuthExtra,
  };
}

/** Read the token hash a successful `verifyIntegrationBearer` stored. */
export function tokenHashFromAuthInfo(authInfo: AuthInfo | undefined): string | null {
  const extra = authInfo?.extra;
  if (!extra || typeof extra !== "object") return null;
  const hash = (extra as Record<string, unknown>)["tokenHash"];
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

interface McpTextContent {
  type: "text";
  text: string;
  [key: string]: unknown;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Shape a service result as an MCP tool result, logging every failure
 * with the same discipline as the REST wrapper. Unauthorized results
 * keep the uniform no-oracle message.
 */
export function toToolResult(
  result: ServiceResult,
  ctx: { action: string; tokenPrefix?: string },
): McpToolResult {
  if (result.ok) {
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
    };
  }
  logIntegrationFailure(result, {
    url: "/api/mcp",
    action: ctx.action,
    tokenPrefix: ctx.tokenPrefix,
  });
  const message =
    result.error === "unauthorized" ? "unauthorized" : redactPat(result.message);
  return {
    isError: true,
    content: [
      { type: "text", text: JSON.stringify({ error: result.error, message }) },
    ],
  };
}
