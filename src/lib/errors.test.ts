import { describe, it, expect } from "vitest";
import { AppError, assertSupabaseOk, toAppError } from "./errors";

describe("AppError construction", () => {
  it("defaults statusCode from the code's DEFAULT_STATUS table when not provided", () => {
    const e = new AppError({
      code: "NOT_FOUND",
      message: "x",
      userMessageKey: "errors.notFound",
    });
    expect(e.statusCode).toBe(404);
  });

  it("honors an explicit statusCode override", () => {
    const e = new AppError({
      code: "VALIDATION_ERROR",
      message: "x",
      userMessageKey: "errors.validation",
      statusCode: 422,
    });
    expect(e.statusCode).toBe(422);
  });

  it("sets severity='error' by default", () => {
    const e = new AppError({
      code: "DATABASE_ERROR",
      message: "x",
      userMessageKey: "errors.database",
    });
    expect(e.severity).toBe("error");
  });

  it("preserves the cause for chained debugging", () => {
    const root = new Error("root cause");
    const e = new AppError({
      code: "UNKNOWN",
      message: "wrapped",
      userMessageKey: "errors.unknown",
      cause: root,
    });
    expect(e.cause).toBe(root);
  });
});

describe("AppError.toUserSafe", () => {
  it("strips message for structured codes (auth / validation)", () => {
    const e = AppError.auth("forbidden");
    const safe = e.toUserSafe();
    expect(safe.code).toBe("AUTH_FORBIDDEN");
    expect(safe.userMessageKey).toBe("errors.authForbidden");
    expect(safe.message).toBeUndefined();
  });

  it("forwards the literal message for UNKNOWN errors", () => {
    const e = AppError.unknown(new Error("boom"));
    const safe = e.toUserSafe();
    expect(safe.message).toBe("boom");
  });

  it("forwards the literal message for CONFLICT (refusal pattern)", () => {
    const e = AppError.refusal("Invoice not voided yet");
    const safe = e.toUserSafe();
    expect(safe.code).toBe("CONFLICT");
    expect(safe.message).toBe("Invoice not voided yet");
  });

  it("includes fieldErrors only on validation errors", () => {
    const e = AppError.validation("bad", { name: "Required" });
    const safe = e.toUserSafe();
    expect(safe.fieldErrors).toEqual({ name: "Required" });
  });

  it("omits fieldErrors when the validation error has no field map", () => {
    const e = AppError.validation("bad");
    const safe = e.toUserSafe();
    expect(safe.fieldErrors).toBeUndefined();
  });
});

describe("AppError factories", () => {
  it("auth() maps each reason to its (code, key) pair", () => {
    expect(AppError.auth("unauthorized").code).toBe("AUTH_UNAUTHORIZED");
    expect(AppError.auth("forbidden").code).toBe("AUTH_FORBIDDEN");
    expect(AppError.auth("session_expired").code).toBe(
      "AUTH_SESSION_EXPIRED",
    );
  });

  it("notFound() includes the entity in details when provided", () => {
    const e = AppError.notFound("Invoice");
    expect(e.code).toBe("NOT_FOUND");
    expect(e.details.entity).toBe("Invoice");
  });

  it("refusal() uses severity=info so the logger skips the admin error log", () => {
    const e = AppError.refusal("not voided");
    expect(e.severity).toBe("info");
    expect(e.code).toBe("CONFLICT");
  });

  it("external() includes the service name and forwards cause", () => {
    const cause = new Error("connect ECONNREFUSED");
    const e = AppError.external("Resend", cause);
    expect(e.code).toBe("EXTERNAL_SERVICE_ERROR");
    expect(e.details.service).toBe("Resend");
    expect(e.cause).toBe(cause);
  });

  it("database() pulls the message from the underlying error when present", () => {
    const e = AppError.database(new Error("connection lost"));
    expect(e.message).toBe("connection lost");
    expect(e.code).toBe("DATABASE_ERROR");
  });

  it("unknown() handles non-Error values via String() coercion", () => {
    expect(AppError.unknown("not an Error").message).toBe("not an Error");
    expect(AppError.unknown(42).message).toBe("42");
    expect(AppError.unknown(null).message).toBe("Unknown error");
    expect(AppError.unknown(undefined).message).toBe("Unknown error");
  });

  it("fromZodError flattens issues into a field-error map (first wins on collisions)", () => {
    const e = AppError.fromZodError({
      issues: [
        { path: ["name"], message: "Required" },
        { path: ["email"], message: "Invalid" },
        { path: ["name"], message: "Too short" }, // collision: first wins
      ],
    });
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.details.fieldErrors).toEqual({
      name: "Required",
      email: "Invalid",
    });
  });

  it("fromZodError ignores issues without a path", () => {
    const e = AppError.fromZodError({
      issues: [{ path: [], message: "Form-level" }],
    });
    expect(e.details.fieldErrors).toEqual({});
  });
});

describe("AppError.fromSupabase", () => {
  it("23505 (unique violation) → CONFLICT with hint preserved", () => {
    const e = AppError.fromSupabase({
      message: "duplicate key",
      code: "23505",
      hint: "Try a different value",
    });
    expect(e.code).toBe("CONFLICT");
    expect(e.details.hint).toBe("Try a different value");
  });

  it("23505 withholds the Postgres-authored message from the client shape (SAL-052)", () => {
    const e = AppError.fromSupabase({
      message: 'duplicate key value violates unique constraint "xyz"',
      code: "23505",
    });
    const safe = e.toUserSafe();
    // The i18n conflict key is the only client-facing channel — the
    // constraint name is an internal detail.
    expect(safe.userMessageKey).toBe("errors.conflict");
    expect(safe.message).toBeUndefined();
    // The raw text stays on the AppError itself for logError/triage.
    expect(e.message).toContain('unique constraint "xyz"');
  });

  it("P0001 (RAISE EXCEPTION default errcode) → CONFLICT forwarding the RPC's user-authored message", () => {
    const e = AppError.fromSupabase({
      message: "only customer admins can add shares",
      code: "P0001",
    });
    expect(e.code).toBe("CONFLICT");
    expect(e.toUserSafe().message).toBe(
      "only customer admins can add shares",
    );
  });

  it("22023 (invalid_parameter_value RPC convention) → CONFLICT forwarding the message", () => {
    const e = AppError.fromSupabase({
      message: "transfer_team_ownership: cannot transfer to yourself",
      code: "22023",
    });
    expect(e.code).toBe("CONFLICT");
    expect(e.toUserSafe().message).toBe(
      "transfer_team_ownership: cannot transfer to yourself",
    );
  });

  it("P0002 (no_data_found) → NOT_FOUND with the i18n key only", () => {
    const e = AppError.fromSupabase({
      message: "Invoice not found.",
      code: "P0002",
    });
    expect(e.code).toBe("NOT_FOUND");
    expect(e.toUserSafe().userMessageKey).toBe("errors.notFound");
    expect(e.toUserSafe().message).toBeUndefined();
  });

  it("23503 (FK violation) → NOT_FOUND", () => {
    const e = AppError.fromSupabase({
      message: "FK violation",
      code: "23503",
    });
    expect(e.code).toBe("NOT_FOUND");
  });

  it("23514 (CHECK violation / trigger raise) → CONFLICT carrying the literal message", () => {
    const e = AppError.fromSupabase({
      message: "Sub-project must belong to same customer",
      code: "23514",
    });
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toBe("Sub-project must belong to same customer");
    // Confirm the message surfaces through toUserSafe.
    expect(e.toUserSafe().message).toBe(
      "Sub-project must belong to same customer",
    );
  });

  it("42501 (RLS insufficient privilege) → AUTH_FORBIDDEN", () => {
    const e = AppError.fromSupabase({
      message: "permission denied",
      code: "42501",
    });
    expect(e.code).toBe("AUTH_FORBIDDEN");
  });

  it("PGRST116 (single row not found) → NOT_FOUND", () => {
    const e = AppError.fromSupabase({
      message: "no rows",
      code: "PGRST116",
    });
    expect(e.code).toBe("NOT_FOUND");
  });

  it("unrecognized code falls through to DATABASE_ERROR", () => {
    const e = AppError.fromSupabase({
      message: "weird postgres internal",
      code: "XX001",
    });
    expect(e.code).toBe("DATABASE_ERROR");
  });

  it("missing code defaults to DATABASE_ERROR", () => {
    const e = AppError.fromSupabase({ message: "no code" });
    expect(e.code).toBe("DATABASE_ERROR");
  });
});

describe("assertSupabaseOk", () => {
  it("returns data when error is null", () => {
    expect(assertSupabaseOk({ data: { id: 1 }, error: null })).toEqual({
      id: 1,
    });
  });

  it("throws an AppError when error is present", () => {
    expect(() =>
      assertSupabaseOk({
        data: null,
        error: { message: "boom", code: "23505" },
      }),
    ).toThrow(AppError);
  });

  it("the thrown AppError reflects fromSupabase classification", () => {
    try {
      assertSupabaseOk({
        data: null,
        error: { message: "denied", code: "42501" },
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AppError).code).toBe("AUTH_FORBIDDEN");
    }
  });
});

describe("toAppError", () => {
  it("passes an AppError through unchanged", () => {
    const original = AppError.notFound("x");
    expect(toAppError(original)).toBe(original);
  });

  it("wraps a plain Error in AppError.unknown", () => {
    const wrapped = toAppError(new Error("plain"));
    expect(wrapped).toBeInstanceOf(AppError);
    expect(wrapped.code).toBe("UNKNOWN");
    expect(wrapped.message).toBe("plain");
  });

  it("coerces non-Error values to a string", () => {
    expect(toAppError("a string").message).toBe("a string");
    expect(toAppError(42).message).toBe("42");
    // `null` → `String(null)` → "null" inside AppError.unknown(String(err)).
    expect(toAppError(null).message).toBe("null");
  });

  // SAL-052 backstop: a raw `throw error` of a PostgREST error object
  // must classify through fromSupabase, never become an UNKNOWN whose
  // verbatim Postgres message is forwarded to the client.
  it("routes a PostgrestError-shaped throw through fromSupabase — raw duplicate-key text never reaches the client shape", () => {
    const wrapped = toAppError({
      name: "PostgrestError",
      message: 'duplicate key value violates unique constraint "xyz"',
      code: "23505",
      details: "Key (name)=(x) already exists.",
      hint: null,
    });
    expect(wrapped.code).toBe("CONFLICT");
    expect(wrapped.toUserSafe().message).toBeUndefined();
    expect(wrapped.toUserSafe().userMessageKey).toBe("errors.conflict");
  });

  it("routes a PostgrestError-shaped trigger RAISE (P0001) through fromSupabase — the user-authored message still surfaces", () => {
    const wrapped = toAppError({
      name: "PostgrestError",
      message: "only customer admins can add shares",
      code: "P0001",
      details: null,
      hint: null,
    });
    expect(wrapped.code).toBe("CONFLICT");
    expect(wrapped.toUserSafe().message).toBe(
      "only customer admins can add shares",
    );
  });

  it("classifies a PostgrestError-shaped unknown SQLSTATE to DATABASE_ERROR (message withheld)", () => {
    const wrapped = toAppError({
      message: 'invalid input syntax for type uuid: "attacker-string"',
      code: "22P02",
      details: null,
      hint: null,
    });
    expect(wrapped.code).toBe("DATABASE_ERROR");
    expect(wrapped.toUserSafe().message).toBeUndefined();
    expect(wrapped.toUserSafe().userMessageKey).toBe("errors.database");
  });

  it("does NOT treat a Node-style Error with a code but no details/hint as PostgREST", () => {
    const nodeErr = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
    });
    const wrapped = toAppError(nodeErr);
    // Falls through to UNKNOWN — the existing verbatim-forwarding
    // contract for our own thrown Errors is unchanged.
    expect(wrapped.code).toBe("UNKNOWN");
    expect(wrapped.toUserSafe().message).toBe("ENOENT: no such file");
  });
});
