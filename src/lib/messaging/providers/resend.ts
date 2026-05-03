import "server-only";

import type {
  DomainStatus,
  MessageSender,
  OutboundMessage,
  SendResult,
} from "../sender";

/**
 * Resend driver for the MessageSender interface.
 *
 * No `resend` SDK dependency — we hit the REST API directly. Reasons:
 *   1. The SDK is a thin fetch wrapper anyway; one less dep.
 *   2. Avoids version-skew between Shyre's Node and the SDK's
 *      transitive deps (the project pins Node 22).
 *   3. Easier to mock in tests (just stub fetch).
 *
 * Each consumer instantiates with their own API key — never share
 * a singleton across teams. The factory `resendSender(apiKey)` makes
 * that explicit.
 */

const BASE_URL = "https://api.resend.com";

interface ResendSendResponse {
  id: string;
}

interface ResendDomainResponse {
  id: string;
  name: string;
  status: "not_started" | "pending" | "verified" | "failed" | "temporary_failure";
  records?: Array<{
    record: string;
    name: string;
    type: string;
    value: string;
    status?: string;
  }>;
}

export function resendSender(apiKey: string): MessageSender {
  if (!apiKey) {
    throw new Error("Resend API key is required.");
  }

  async function call<T>(
    path: string,
    init: RequestInit,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new ResendError(res.status, body, path);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    async send(msg: OutboundMessage): Promise<SendResult> {
      const payload = {
        from: msg.from.name
          ? `${msg.from.name} <${msg.from.email}>`
          : msg.from.email,
        to: msg.to.map(formatAddress),
        cc: msg.cc?.map(formatAddress),
        bcc: msg.bcc?.map(formatAddress),
        reply_to: msg.replyTo ? [msg.replyTo] : undefined,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content.toString("base64"),
          content_type: a.contentType,
        })),
        headers: msg.headers,
        tags: msg.tags
          ? Object.entries(msg.tags).map(([name, value]) => ({
              name,
              value,
            }))
          : undefined,
      };

      const response = await call<ResendSendResponse>(
        "/emails",
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
        msg.idempotencyKey,
      );

      return {
        providerMessageId: response.id,
        provider: "resend",
        acceptedAt: new Date(),
      };
    },

    async ensureDomain(domain: string): Promise<DomainStatus> {
      // Resend's POST /domains is create-only; if the domain
      // already exists the call 422s. List first; create if absent.
      const list = await call<{ data: ResendDomainResponse[] }>(
        "/domains",
        { method: "GET" },
      );
      const existing = list.data.find(
        (d) => d.name.toLowerCase() === domain.toLowerCase(),
      );
      const created = existing
        ? existing
        : await call<ResendDomainResponse>("/domains", {
            method: "POST",
            body: JSON.stringify({ name: domain }),
          });

      // Re-fetch with records — list endpoint omits them.
      const detail = await call<ResendDomainResponse>(
        `/domains/${created.id}`,
        { method: "GET" },
      );
      return mapDomainResponse(detail);
    },

    async refreshDomain(providerDomainId: string): Promise<DomainStatus> {
      // Resend's verify endpoint kicks a fresh DNS lookup; the
      // detail endpoint returns the latest status.
      await call(`/domains/${providerDomainId}/verify`, { method: "POST" });
      const detail = await call<ResendDomainResponse>(
        `/domains/${providerDomainId}`,
        { method: "GET" },
      );
      return mapDomainResponse(detail);
    },
  };
}

function formatAddress(a: { email: string; name?: string }): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

function mapDomainResponse(d: ResendDomainResponse): DomainStatus {
  const status: DomainStatus["status"] =
    d.status === "verified"
      ? "verified"
      : d.status === "failed"
        ? "failed"
        : "pending";
  return {
    domain: d.name,
    providerDomainId: d.id,
    status,
    dnsRecords: (d.records ?? []).map((r) => ({
      type: (r.type.toUpperCase() as "TXT" | "CNAME" | "MX") ?? "TXT",
      name: r.name,
      value: r.value,
      purpose: classifyPurpose(r.record),
    })),
    failureReason: status === "failed" ? d.status : undefined,
  };
}

function classifyPurpose(
  record: string,
): "spf" | "dkim" | "dmarc" | "return_path" {
  const r = (record ?? "").toLowerCase();
  if (r.includes("spf")) return "spf";
  if (r.includes("dmarc")) return "dmarc";
  if (r.includes("return") || r.includes("mx")) return "return_path";
  return "dkim";
}

export class ResendError extends Error {
  constructor(
    public readonly status: number,
    public readonly bodyText: string,
    public readonly path: string,
  ) {
    super(`Resend ${path} returned ${status}: ${bodyText.slice(0, 200)}`);
    this.name = "ResendError";
  }
}
