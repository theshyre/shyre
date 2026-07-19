import "server-only";

import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { AppError, type ErrorCode } from "@/lib/errors";
import { logError } from "@/lib/logger";

import type { IntegrationErrorCode, ServiceFailure, ServiceResult } from "./service";
import { TOKEN_PREFIX, extractBearerPat, redactPat, sha256Hex } from "./tokens";

/**
 * Shared request wrapper for every /api/v1 route (SAL-051).
 *
 * A route on this surface that skips the wrapper is PUBLIC — the
 * middleware exempts /api/v1 from session auth by design, so bearer-PAT
 * verification here is the only gate. `integrations-route-parity.test.ts`
 * greps the route sources to enforce that every handler goes through
 * `runIntegrationRoute`.
 *
 * Responsibilities:
 * - Accept the PAT from the Authorization header ONLY (never query,
 *   cookie, or body — those land in logs and transcripts).
 * - sha256 the PAT and hand ONLY the hash to the service layer.
 * - Zod-validate POST bodies (schemas are `.strict()` — unknown keys
 *   are rejected, not silently dropped).
 * - Map service failures to the stable `{ error: code }` envelope. All
 *   401 shapes (missing header, malformed token, unknown, revoked,
 *   expired, kill switch, offboarded) return ONE uniform body — no
 *   oracle for probing token state.
 * - logError() on EVERY non-2xx, always PAT-redacted, never the
 *   Authorization header. Context carries the display prefix only.
 */

const UNAUTHORIZED_BODY = { error: "unauthorized" } as const;

/** Display prefix ("shyre_pat_ab34cd") — safe for logs, cannot authenticate. */
function displayPrefix(pat: string): string {
  return pat.slice(0, TOKEN_PREFIX.length + 6);
}

const FAILURE_APP_CODE: Record<IntegrationErrorCode, ErrorCode> = {
  invalid_request: "VALIDATION_ERROR",
  unauthorized: "AUTH_UNAUTHORIZED",
  forbidden: "AUTH_FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  rate_limited: "RATE_LIMIT",
  internal: "DATABASE_ERROR",
};

interface FailureContext {
  url: string;
  action: string;
  tokenPrefix?: string;
}

/**
 * Log a service failure and build its HTTP response. Exported for the
 * MCP layer, which shares the logging discipline but shapes tool
 * results instead of HTTP responses.
 */
export function logIntegrationFailure(
  failure: ServiceFailure,
  ctx: FailureContext,
): void {
  logError(
    new AppError({
      code: FAILURE_APP_CODE[failure.error],
      message: redactPat(failure.message),
      userMessageKey: "errors.unknown",
      statusCode: failure.status,
      // 4xx are expected refusals of an external caller; 5xx are ours.
      // Both must land in /admin/errors (the SAL-051 post-deploy probe
      // checks that bad-token attempts are visible), so never "info".
      severity: failure.status >= 500 ? "error" : "warning",
      details: {
        integrationError: failure.error,
        tokenPrefix: ctx.tokenPrefix ?? null,
      },
    }),
    { url: ctx.url, action: ctx.action },
  );
}

function failureResponse(failure: ServiceFailure, ctx: FailureContext): Response {
  logIntegrationFailure(failure, ctx);
  if (failure.status === 401) {
    // Uniform body — the reason (unknown vs revoked vs expired vs kill
    // switch) is in the audit trail, never in the response.
    return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 });
  }
  if (failure.status === 409) {
    // Conflicts are actionable for the agent ("timer already running",
    // "overlaps existing entries") — forward the redacted detail.
    return NextResponse.json(
      { error: failure.error, message: redactPat(failure.message) },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: failure.error }, { status: failure.status });
}

interface IntegrationRouteConfig<Body> {
  /** logError/audit context, e.g. "api.v1.timer.start". */
  action: string;
  /** Strict Zod schema for the JSON body; omit for GET routes. */
  bodySchema?: ZodType<Body>;
  /** The service call — receives the sha256 hash, NEVER the raw PAT. */
  invoke: (tokenHash: string, body: Body) => Promise<ServiceResult>;
}

export async function runIntegrationRoute<Body = undefined>(
  request: Request,
  config: IntegrationRouteConfig<Body>,
): Promise<Response> {
  const { action } = config;
  const url = request.url;

  const pat = extractBearerPat(request.headers.get("authorization"));
  if (!pat) {
    logError(
      new AppError({
        code: "AUTH_UNAUTHORIZED",
        message: "integration request without a well-formed bearer PAT",
        userMessageKey: "errors.authUnauthorized",
        // "info" = not persisted (logger drops info): a request with NO
        // Authorization header at all is scanner/browser noise with zero
        // forensic value — it was landing an unresolved warning per hit.
        // Token-SHAPED but invalid attempts (the brute-force signal) still
        // log at warning via the invalid-token path.
        severity: "info",
      }),
      { url, action },
    );
    return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 });
  }
  const tokenPrefix = displayPrefix(pat);

  let body = undefined as Body;
  if (config.bodySchema) {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch (err) {
      logError(
        new AppError({
          code: "VALIDATION_ERROR",
          message: "integration request body is not valid JSON",
          userMessageKey: "errors.validation",
          severity: "warning",
          details: { tokenPrefix },
          cause: err,
        }),
        { url, action },
      );
      return NextResponse.json(
        { error: "invalid_request", message: "request body must be valid JSON" },
        { status: 400 },
      );
    }
    const parsed = config.bodySchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: redactPat(issue.message),
      }));
      logError(
        new AppError({
          code: "VALIDATION_ERROR",
          message: "integration request body failed validation",
          userMessageKey: "errors.validation",
          severity: "warning",
          details: { tokenPrefix, issues },
        }),
        { url, action },
      );
      return NextResponse.json(
        { error: "invalid_request", issues },
        { status: 400 },
      );
    }
    body = parsed.data;
  }

  const result = await config.invoke(sha256Hex(pat), body);
  if (result.ok) {
    return NextResponse.json(result.data);
  }
  return failureResponse(result, { url, action, tokenPrefix });
}
