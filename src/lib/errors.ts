/**
 * Structured error system — built once, used everywhere.
 *
 * Single AppError class with discriminated ErrorCode.
 * Factory methods for common error types.
 * assertSupabaseOk() for Supabase result checking.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTH_UNAUTHORIZED"
  | "AUTH_FORBIDDEN"
  | "AUTH_SESSION_EXPIRED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "EXTERNAL_SERVICE_ERROR"
  | "DATABASE_ERROR"
  | "RATE_LIMIT"
  | "UNKNOWN";

export type ErrorSeverity = "error" | "warning" | "info";

export interface SerializedAppError {
  code: ErrorCode;
  userMessageKey: string;
  statusCode: number;
  fieldErrors?: Record<string, string>;
  /** Optional verbatim message — populated only when code === "UNKNOWN".
   *
   *  Structured errors (validation, auth, conflict, …) carry an i18n
   *  key in `userMessageKey`; the client translates and shows that.
   *
   *  Ad-hoc `throw new Error("user-readable explanation")` paths in
   *  actions normalize to `AppError.unknown(err)` — those originate
   *  inside the app's own code and are deliberately written for the
   *  user, so passing the literal message through is correct. (We
   *  don't include `cause.stack` or anything else — just the
   *  message string the action chose to throw.)
   *
   *  For non-UNKNOWN codes this stays undefined so structured errors
   *  can't accidentally leak internal text. */
  message?: string;
}

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTH_UNAUTHORIZED: 401,
  AUTH_FORBIDDEN: 403,
  AUTH_SESSION_EXPIRED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  EXTERNAL_SERVICE_ERROR: 502,
  DATABASE_ERROR: 500,
  RATE_LIMIT: 429,
  UNKNOWN: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessageKey: string;
  readonly statusCode: number;
  readonly details: Record<string, unknown>;
  readonly severity: ErrorSeverity;
  readonly cause?: unknown;
  /** When false, `toUserSafe()` withholds the literal message even for
   *  UNKNOWN/CONFLICT codes. Used for raw Postgres text (e.g. a 23505
   *  "duplicate key value violates unique constraint …") that classifies
   *  to CONFLICT but was written by Postgres, not for users (SAL-052).
   *  Defaults to true — messages authored by our own code keep
   *  surfacing. */
  readonly forwardMessage: boolean;

  constructor(opts: {
    code: ErrorCode;
    message: string;
    userMessageKey: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    severity?: ErrorSeverity;
    cause?: unknown;
    forwardMessage?: boolean;
  }) {
    super(opts.message);
    this.name = "AppError";
    this.code = opts.code;
    this.userMessageKey = opts.userMessageKey;
    this.statusCode = opts.statusCode ?? DEFAULT_STATUS[opts.code] ?? 500;
    this.details = opts.details ?? {};
    this.severity = opts.severity ?? "error";
    this.cause = opts.cause;
    this.forwardMessage = opts.forwardMessage ?? true;
  }

  /** Safe representation for client transport — never leaks internals */
  toUserSafe(): SerializedAppError {
    const result: SerializedAppError = {
      code: this.code,
      userMessageKey: this.userMessageKey,
      statusCode: this.statusCode,
    };
    if (this.code === "VALIDATION_ERROR" && this.details.fieldErrors) {
      result.fieldErrors = this.details.fieldErrors as Record<string, string>;
    }
    // Forward the literal message for UNKNOWN- and CONFLICT-coded
    // errors. UNKNOWN originates from `throw new Error("…")` inside
    // our own actions; CONFLICT is the deliberate-refusal factory
    // (AppError.refusal) used for business-rule blocks like
    // "1 manual time entry exists on a project this import created."
    // Both are deliberately written for the user. Structured codes
    // (auth, validation, …) still keep their i18n key as the only
    // client-facing channel so internal text from third-party
    // libraries can't slip through.
    if (
      (this.code === "UNKNOWN" || this.code === "CONFLICT") &&
      this.message &&
      this.forwardMessage
    ) {
      result.message = this.message;
    }
    return result;
  }

  // --- Factory methods ---

  static validation(
    message: string,
    fieldErrors?: Record<string, string>
  ): AppError {
    return new AppError({
      code: "VALIDATION_ERROR",
      message,
      userMessageKey: "errors.validation",
      severity: "warning",
      details: fieldErrors ? { fieldErrors } : {},
    });
  }

  static fromZodError(zodError: { issues: Array<{ path: (string | number)[]; message: string }> }): AppError {
    const fieldErrors: Record<string, string> = {};
    for (const issue of zodError.issues) {
      const path = issue.path.join(".");
      if (path && !fieldErrors[path]) {
        fieldErrors[path] = issue.message;
      }
    }
    return AppError.validation("Validation failed", fieldErrors);
  }

  static auth(
    reason: "unauthorized" | "forbidden" | "session_expired" = "unauthorized"
  ): AppError {
    const codeMap: Record<string, ErrorCode> = {
      unauthorized: "AUTH_UNAUTHORIZED",
      forbidden: "AUTH_FORBIDDEN",
      session_expired: "AUTH_SESSION_EXPIRED",
    };
    const keyMap: Record<string, string> = {
      unauthorized: "errors.authUnauthorized",
      forbidden: "errors.authForbidden",
      session_expired: "errors.authSessionExpired",
    };
    return new AppError({
      code: codeMap[reason] ?? "AUTH_UNAUTHORIZED",
      message: `Authentication error: ${reason}`,
      userMessageKey: keyMap[reason] ?? "errors.authUnauthorized",
    });
  }

  static notFound(entity?: string): AppError {
    return new AppError({
      code: "NOT_FOUND",
      message: `Not found: ${entity ?? "resource"}`,
      userMessageKey: "errors.notFound",
      details: entity ? { entity } : {},
    });
  }

  static conflict(message?: string): AppError {
    return new AppError({
      code: "CONFLICT",
      message: message ?? "Resource conflict",
      userMessageKey: "errors.conflict",
    });
  }

  /**
   * Deliberate business-rule refusal — "this can't happen because
   * the data isn't in the right state." Examples: invoice can't be
   * deleted because it's not voided yet; undo can't proceed
   * because manual entries depend on imported records.
   *
   * Severity = "info" so logger.ts skips the admin error-log write
   * (these are expected user-facing refusals, not bugs needing
   * attention). The CONFLICT code (409) signals "client should
   * adjust state and retry" to any future API consumer.
   *
   * Use this instead of `throw new Error("…")` for any deliberate
   * refusal whose message is written for the user. UNKNOWN-coded
   * errors still log as "error" — that's the catch-all for
   * unexpected throws (network, type errors, library bugs) which
   * legitimately want admin attention.
   */
  static refusal(message: string): AppError {
    return new AppError({
      code: "CONFLICT",
      message,
      userMessageKey: "errors.conflict",
      severity: "info",
    });
  }

  static external(service: string, cause?: unknown): AppError {
    return new AppError({
      code: "EXTERNAL_SERVICE_ERROR",
      message: `External service error: ${service}`,
      userMessageKey: "errors.externalService",
      details: { service },
      cause,
    });
  }

  static database(cause?: unknown): AppError {
    const message =
      cause instanceof Error ? cause.message : "Database error";
    return new AppError({
      code: "DATABASE_ERROR",
      message,
      userMessageKey: "errors.database",
      cause,
    });
  }

  static unknown(cause?: unknown): AppError {
    const message =
      cause instanceof Error ? cause.message : String(cause ?? "Unknown error");
    return new AppError({
      code: "UNKNOWN",
      message,
      userMessageKey: "errors.unknown",
      cause,
    });
  }

  /**
   * Classify a Supabase/PostgREST error into an AppError.
   */
  static fromSupabase(pgError: {
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  }): AppError {
    const pgCode = pgError.code ?? "";

    // Unique violation. The message is Postgres-authored ("duplicate
    // key value violates unique constraint \"…\"" — constraint names
    // are internals), so it must NOT ride the CONFLICT message
    // forwarding to the client (SAL-052). The i18n conflict key
    // carries the user-facing meaning; the raw text stays on the
    // AppError for logError/admin triage.
    if (pgCode === "23505") {
      return new AppError({
        code: "CONFLICT",
        message: pgError.message,
        userMessageKey: "errors.conflict",
        details: { pgCode, hint: pgError.hint },
        forwardMessage: false,
      });
    }

    // Foreign key violation
    if (pgCode === "23503") {
      return new AppError({
        code: "NOT_FOUND",
        message: pgError.message,
        userMessageKey: "errors.notFound",
        details: { pgCode },
      });
    }

    // CHECK constraint or trigger-raised check_violation. Triggers
    // throw user-meaningful messages (e.g. "Sub-project must belong
    // to the same customer as its parent"). Map to CONFLICT so the
    // literal message surfaces through `toUserSafe()` (UNKNOWN +
    // CONFLICT both forward `message` to the client). Generic
    // "database error" toast would hide the trigger's intent.
    if (pgCode === "23514") {
      return new AppError({
        code: "CONFLICT",
        message: pgError.message,
        userMessageKey: "errors.conflict",
        details: { pgCode },
      });
    }

    // Deliberate RAISE EXCEPTION from our own PL/pgSQL:
    //  - P0001 (raise_exception, the default ERRCODE) — legacy RPCs
    //    like add_customer_share ("only customer admins can add
    //    shares") raise user-meaningful refusals without an explicit
    //    ERRCODE.
    //  - 22023 (invalid_parameter_value) — the team-role-transition
    //    RPCs' convention for caller mistakes ("cannot transfer to
    //    yourself").
    // Both texts are authored by us for the user, never by Postgres
    // itself, so they surface verbatim via the CONFLICT forwarding —
    // same rationale as 23514 above (SAL-052).
    if (pgCode === "P0001" || pgCode === "22023") {
      return new AppError({
        code: "CONFLICT",
        message: pgError.message,
        userMessageKey: "errors.conflict",
        details: { pgCode },
      });
    }

    // no_data_found — RPCs raise this for "target row doesn't exist"
    // (e.g. edit_invoice_paid_date's "Invoice not found.").
    if (pgCode === "P0002") {
      return new AppError({
        code: "NOT_FOUND",
        message: pgError.message,
        userMessageKey: "errors.notFound",
        details: { pgCode },
      });
    }

    // Insufficient privilege (RLS)
    if (pgCode === "42501") {
      return new AppError({
        code: "AUTH_FORBIDDEN",
        message: pgError.message,
        userMessageKey: "errors.authForbidden",
        details: { pgCode },
      });
    }

    // PostgREST not found
    if (pgCode === "PGRST116") {
      return new AppError({
        code: "NOT_FOUND",
        message: pgError.message,
        userMessageKey: "errors.notFound",
        details: { pgCode },
      });
    }

    // Default: database error
    return new AppError({
      code: "DATABASE_ERROR",
      message: pgError.message,
      userMessageKey: "errors.database",
      details: { pgCode, hint: pgError.hint, details: pgError.details },
    });
  }
}

/**
 * Assert a Supabase query result is successful.
 * Throws AppError if there's an error.
 */
export function assertSupabaseOk<T>(result: {
  data: T;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
}): T {
  if (result.error) {
    throw AppError.fromSupabase(result.error);
  }
  return result.data;
}

/**
 * Detect a PostgREST/Postgres error that was thrown raw instead of
 * being classified through `assertSupabaseOk` / `AppError.fromSupabase`.
 *
 * `PostgrestError` extends `Error` and always carries string `code`,
 * `details`, and `hint` properties — no other error type in the app
 * has that shape (Node errors have `code` but never `details`+`hint`;
 * GoTrue's AuthError has `code`+`status` but no `details`/`hint`).
 */
function isPostgrestErrorShape(err: unknown): err is {
  message: string;
  code: string;
  details?: string;
  hint?: string;
} {
  if (typeof err !== "object" || err === null) return false;
  const candidate = err as Record<string, unknown>;
  return (
    typeof candidate.message === "string" &&
    typeof candidate.code === "string" &&
    "details" in candidate &&
    "hint" in candidate
  );
}

/**
 * Normalize any caught value into an AppError.
 *
 * PostgREST error objects are routed through `fromSupabase` so a raw
 * `throw error` at a call site can never reach the client as an
 * UNKNOWN-coded error whose verbatim Postgres message gets forwarded
 * (SAL-030/SAL-052 class). This is the systemic backstop; call sites
 * should still classify explicitly via `assertSupabaseOk` /
 * `AppError.fromSupabase`.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (isPostgrestErrorShape(err)) return AppError.fromSupabase(err);
  if (err instanceof Error) return AppError.unknown(err);
  return AppError.unknown(String(err));
}
