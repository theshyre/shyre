import { describe, it, expect } from "vitest";
import {
  ALLOWED_DOMAIN_STATUS,
  ALLOWED_OUTBOX_STATUS,
  ALLOWED_RELATED_KINDS,
} from "./allow-lists";

describe("messaging allow-lists", () => {
  it("ALLOWED_OUTBOX_STATUS covers both queued + terminal states", () => {
    // Spot-check: the queued / sending / sent triplet that drives the
    // outbox state machine, plus the two failure terminals.
    expect(ALLOWED_OUTBOX_STATUS.has("queued")).toBe(true);
    expect(ALLOWED_OUTBOX_STATUS.has("sending")).toBe(true);
    expect(ALLOWED_OUTBOX_STATUS.has("sent")).toBe(true);
    expect(ALLOWED_OUTBOX_STATUS.has("failed_retryable")).toBe(true);
    expect(ALLOWED_OUTBOX_STATUS.has("failed_permanent")).toBe(true);
  });

  it("ALLOWED_OUTBOX_STATUS excludes typos / unknown values", () => {
    // @ts-expect-error testing that off-vocab strings aren't in the Set
    expect(ALLOWED_OUTBOX_STATUS.has("delivering")).toBe(false);
    // @ts-expect-error testing that the empty string isn't in the Set
    expect(ALLOWED_OUTBOX_STATUS.has("")).toBe(false);
  });

  it("ALLOWED_RELATED_KINDS matches the three documented message-kind buckets", () => {
    expect(ALLOWED_RELATED_KINDS.has("invoice")).toBe(true);
    expect(ALLOWED_RELATED_KINDS.has("invoice_reminder")).toBe(true);
    expect(ALLOWED_RELATED_KINDS.has("payment_thanks")).toBe(true);
    expect(ALLOWED_RELATED_KINDS.size).toBe(3);
  });

  it("ALLOWED_DOMAIN_STATUS mirrors Resend's three-state domain machine", () => {
    expect(ALLOWED_DOMAIN_STATUS.has("pending")).toBe(true);
    expect(ALLOWED_DOMAIN_STATUS.has("verified")).toBe(true);
    expect(ALLOWED_DOMAIN_STATUS.has("failed")).toBe(true);
    expect(ALLOWED_DOMAIN_STATUS.size).toBe(3);
  });

  it("each allow-list contains only string members (sanity)", () => {
    for (const v of ALLOWED_OUTBOX_STATUS) expect(typeof v).toBe("string");
    for (const v of ALLOWED_RELATED_KINDS) expect(typeof v).toBe("string");
    for (const v of ALLOWED_DOMAIN_STATUS) expect(typeof v).toBe("string");
  });
});
