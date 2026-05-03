import "server-only";

/**
 * Provider-agnostic outbound-message contract.
 *
 * Phase 1 ships Resend; Postmark / SES / SendGrid plug in via this
 * interface. The shape is intentionally narrow + portable across the
 * common providers — no Resend-specific scheduling, no React-Email
 * rendering, no batch endpoints.
 */

export interface OutboundAddress {
  email: string;
  name?: string;
}

export interface OutboundAttachment {
  filename: string;
  /** Raw bytes. Provider-side base64 encoding (Resend's expectation)
   *  happens in the Resend driver, not here. */
  content: Buffer;
  contentType: string;
}

export interface OutboundMessage {
  from: OutboundAddress;
  to: OutboundAddress[];
  cc?: OutboundAddress[];
  bcc?: OutboundAddress[];
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: OutboundAttachment[];
  /** Headers applied verbatim. Use for List-Unsubscribe etc. */
  headers?: Record<string, string>;
  /** Caller-controlled idempotency key. Providers that support it
   *  (Resend, Postmark) get it as a request header; callers also
   *  store it on `message_outbox.idempotency_key` so retries don't
   *  double-send through the queue. */
  idempotencyKey: string;
  /** Free-form key/value tags surfaced to the provider for
   *  filtering (Resend tags, Postmark metadata). Format chosen so
   *  every provider accepts it. */
  tags?: Record<string, string>;
}

export interface SendResult {
  /** Provider's canonical message id (Resend `id`, Postmark MessageID,
   *  SES MessageId). Stored on `message_outbox.provider_message_id`
   *  for webhook correlation and forensic disclosure. */
  providerMessageId: string;
  provider: "resend";
  acceptedAt: Date;
}

export interface DomainStatus {
  domain: string;
  /** Provider-side identifier so the webhook handler can look back
   *  to verified_email_domains by id, not domain. */
  providerDomainId: string;
  status: "pending" | "verified" | "failed";
  /** DNS records the user must add. Each record is rendered in the
   *  settings UI with a copy-to-clipboard. The shape varies per
   *  provider so this is JSON-bag. */
  dnsRecords: Array<{
    type: "TXT" | "CNAME" | "MX";
    name: string;
    value: string;
    purpose: "spf" | "dkim" | "dmarc" | "return_path";
  }>;
  failureReason?: string;
}

export interface MessageSender {
  send(msg: OutboundMessage): Promise<SendResult>;

  /** Add or look up a domain in the provider. Returns the verification
   *  status + DNS records to add. Idempotent — safe to call repeatedly
   *  while the user is fiddling with their DNS. */
  ensureDomain(domain: string): Promise<DomainStatus>;

  /** Re-check a domain's verification state. Resend caches DNS lookups,
   *  so calling this triggers a fresh DNS check on their side. */
  refreshDomain(providerDomainId: string): Promise<DomainStatus>;
}
