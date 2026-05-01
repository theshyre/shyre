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

  constructor(opts: {
    code: ErrorCode;
    message: string;
    userMessageKey: string;
    statusCode?: number;
    details?: Record<string, unknown>;
    severity?: ErrorSeverity;
    cause?: unknown;
  }) {
    super(opts.message);
    this.name = "AppError";
    this.code = opts.code;
    this.userMessageKey = opts.userMessageKey;
    this.statusCode = opts.statusCode ?? DEFAULT_STATUS[opts.code] ?? 500;
    this.details = opts.details ?? {};
    this.severity = opts.severity ?? "error";
    this.cause = opts.cause;
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
    // Forward the literal message for UNKNOWN-coded errors only —
    // those originate from `throw new Error("user-readable text")`
    // inside our own actions and are deliberately written for the
    // user. Structured codes (auth, validation, conflict, …) keep
    // their i18n key as the only client-facing channel so internal
    // text from third-party libraries can't slip through.
    if (this.code === "UNKNOWN" && this.message) {
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

    // Unique violation
    if (pgCode === "23505") {
      return new AppError({
        code: "CONFLICT",
        message: pgError.message,
        userMessageKey: "errors.conflict",
        details: { pgCode, hint: pgError.hint },
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
 * Normalize any caught value into an AppError.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) return AppError.unknown(err);
  return AppError.unknown(String(err));
}
