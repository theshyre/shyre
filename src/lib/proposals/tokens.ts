import "server-only";

/**
 * Proposals sign-off token + OTP crypto.
 *
 * The generic implementation moved to `src/lib/sign/tokens.ts` (SAL-036
 * primitives are shared across every sign-off surface — proposals, document /
 * release sign-off, …). This module re-exports it so existing proposal call
 * sites (`sign-service.ts`, `actions.ts`, tests) are unchanged.
 */
export * from "@/lib/sign/tokens";
