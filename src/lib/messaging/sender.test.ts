import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  OutboundMessage,
  MessageSender,
  SendResult,
  DomainStatus,
} from "./sender";

/**
 * sender.ts is a pure contract — interfaces only, no runtime code.
 * These tests pin the provider-agnostic contract at the type level so
 * a "small" interface change (dropping the idempotency key, widening
 * the provider union, loosening a DNS record type) fails here with a
 * readable diff instead of surfacing as a drift bug inside a driver.
 * A minimal conforming in-memory sender proves the contract is
 * implementable exactly as declared.
 */

const validMessage: OutboundMessage = {
  from: { email: "billing@malcom.io", name: "Shyre" },
  to: [{ email: "ap@acme.test" }],
  subject: "Invoice INV-2026-014",
  html: "<p>Hi</p>",
  text: "Hi",
  idempotencyKey: "outbox-row-uuid",
};

describe("messaging sender contract", () => {
  it("requires the idempotency key and both body formats on every message", () => {
    // These are the anti-double-send and anti-spam-filter guarantees;
    // no driver may treat them as optional.
    expectTypeOf<OutboundMessage>().toHaveProperty("idempotencyKey");
    expectTypeOf<OutboundMessage["idempotencyKey"]>().toEqualTypeOf<string>();
    expectTypeOf<OutboundMessage["html"]>().toEqualTypeOf<string>();
    expectTypeOf<OutboundMessage["text"]>().toEqualTypeOf<string>();
    // cc/bcc/attachments/tags stay optional — the minimal message
    // above must remain valid.
    expect(validMessage.cc).toBeUndefined();
    expect(validMessage.attachments).toBeUndefined();
  });

  it("attachment content is raw bytes — base64 is the driver's job, not the caller's", () => {
    expectTypeOf<
      NonNullable<OutboundMessage["attachments"]>[number]["content"]
    >().toEqualTypeOf<Buffer>();
  });

  it("pins the provider union and domain-status vocabulary webhooks depend on", () => {
    expectTypeOf<SendResult["provider"]>().toEqualTypeOf<"resend">();
    expectTypeOf<DomainStatus["status"]>().toEqualTypeOf<
      "pending" | "verified" | "failed"
    >();
    expectTypeOf<
      DomainStatus["dnsRecords"][number]["type"]
    >().toEqualTypeOf<"TXT" | "CNAME" | "MX">();
    expectTypeOf<
      DomainStatus["dnsRecords"][number]["purpose"]
    >().toEqualTypeOf<"spf" | "dkim" | "dmarc" | "return_path">();
  });

  it("is implementable as declared — a conforming in-memory sender round-trips a message", async () => {
    const sent: OutboundMessage[] = [];
    const fake: MessageSender = {
      async send(msg): Promise<SendResult> {
        sent.push(msg);
        return {
          providerMessageId: `fake-${msg.idempotencyKey}`,
          provider: "resend",
          acceptedAt: new Date("2026-07-18T00:00:00Z"),
        };
      },
      async ensureDomain(domain): Promise<DomainStatus> {
        return {
          domain,
          providerDomainId: "dom-1",
          status: "pending",
          dnsRecords: [
            {
              type: "MX",
              name: `send.${domain}`,
              value: "feedback-smtp.resend.example",
              purpose: "return_path",
              priority: 10,
            },
          ],
        };
      },
      async refreshDomain(providerDomainId): Promise<DomainStatus> {
        return {
          domain: "malcom.io",
          providerDomainId,
          status: "verified",
          dnsRecords: [],
        };
      },
    };

    const result = await fake.send(validMessage);
    expect(result.providerMessageId).toBe("fake-outbox-row-uuid");
    expect(sent).toHaveLength(1);

    const domain = await fake.ensureDomain("malcom.io");
    expect(domain.dnsRecords[0]).toMatchObject({ type: "MX", priority: 10 });
    const refreshed = await fake.refreshDomain(domain.providerDomainId);
    expect(refreshed.status).toBe("verified");
  });
});
