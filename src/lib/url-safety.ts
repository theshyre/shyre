import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";

/**
 * SSRF guard for outbound URLs supplied by users.
 *
 * Validates that a user-supplied URL is safe to `fetch()` from the
 * server. Rejects:
 *   - non-https (Atlassian Cloud is always HTTPS; we don't allow
 *     plain http for any integration)
 *   - hostnames that resolve to private (RFC 1918), loopback,
 *     link-local (169.254/16, fe80::/10), CGNAT (100.64/10), or
 *     unique-local IPv6 ranges
 *   - cloud-metadata endpoints by literal IP
 *
 * Used by every server-side `fetch()` whose URL comes from
 * user input (Jira base URL, future webhook destinations, future
 * SaaS-integration URLs, etc.). GitHub-style fixed-host integrations
 * don't need this — the host is hardcoded.
 *
 * Caller responsibility: ALSO pass `redirect: "manual"` to `fetch()`
 * so a 30x to a private host can't bypass the host check.
 */
export class UnsafeOutboundUrlError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = "UnsafeOutboundUrlError";
  }
}

const PRIVATE_IPV4_RANGES: ReadonlyArray<{
  readonly start: number;
  readonly end: number;
  readonly label: string;
}> = [
  { start: ipv4ToInt("0.0.0.0"), end: ipv4ToInt("0.255.255.255"), label: "0.0.0.0/8" },
  { start: ipv4ToInt("10.0.0.0"), end: ipv4ToInt("10.255.255.255"), label: "10.0.0.0/8" },
  { start: ipv4ToInt("100.64.0.0"), end: ipv4ToInt("100.127.255.255"), label: "100.64/10 CGNAT" },
  { start: ipv4ToInt("127.0.0.0"), end: ipv4ToInt("127.255.255.255"), label: "loopback" },
  { start: ipv4ToInt("169.254.0.0"), end: ipv4ToInt("169.254.255.255"), label: "169.254/16 link-local + cloud metadata" },
  { start: ipv4ToInt("172.16.0.0"), end: ipv4ToInt("172.31.255.255"), label: "172.16/12" },
  { start: ipv4ToInt("192.0.0.0"), end: ipv4ToInt("192.0.0.255"), label: "192.0.0/24" },
  { start: ipv4ToInt("192.168.0.0"), end: ipv4ToInt("192.168.255.255"), label: "192.168/16" },
  { start: ipv4ToInt("198.18.0.0"), end: ipv4ToInt("198.19.255.255"), label: "198.18/15 benchmark" },
  { start: ipv4ToInt("224.0.0.0"), end: ipv4ToInt("239.255.255.255"), label: "multicast" },
  { start: ipv4ToInt("240.0.0.0"), end: ipv4ToInt("255.255.255.255"), label: "reserved" },
];

function ipv4ToInt(addr: string): number {
  const parts = addr.split(".").map(Number);
  return (
    ((parts[0] ?? 0) << 24) +
    ((parts[1] ?? 0) << 16) +
    ((parts[2] ?? 0) << 8) +
    (parts[3] ?? 0)
  );
}

function isPrivateIpv4(addr: string): { blocked: boolean; reason?: string } {
  const n = ipv4ToInt(addr);
  for (const range of PRIVATE_IPV4_RANGES) {
    if (n >= range.start && n <= range.end) {
      return { blocked: true, reason: `IPv4 in ${range.label}` };
    }
  }
  return { blocked: false };
}

function isPrivateIpv6(addr: string): { blocked: boolean; reason?: string } {
  const lower = addr.toLowerCase().replace(/%.*$/, "");
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
    return { blocked: true, reason: "IPv6 loopback" };
  }
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) {
    return { blocked: true, reason: "IPv6 link-local fe80::/10" };
  }
  if (lower.startsWith("fc") || lower.startsWith("fd")) {
    return { blocked: true, reason: "IPv6 unique-local fc00::/7" };
  }
  // IPv4-mapped IPv6 — dotted-decimal form (::ffff:a.b.c.d) and
  // hex-pair form (::ffff:7f00:1, which is what URL normalizes
  // ::ffff:127.0.0.1 to). Block the entire ::ffff: prefix; this
  // form is almost never legitimate for outbound integrations and
  // the dotted-decimal variant has been used as a private-IP-
  // bypass technique.
  if (lower.startsWith("::ffff:")) {
    return { blocked: true, reason: "IPv4-mapped IPv6 ::ffff:" };
  }
  return { blocked: false };
}

/**
 * Validate that `urlString` is safe to fetch from the server.
 * Throws `UnsafeOutboundUrlError` on rejection. On success the
 * caller can `fetch(urlString, { redirect: "manual" })`.
 *
 * Options:
 *   - `allowedHostSuffixes`: optional list of host suffixes (e.g.
 *     [".atlassian.net", ".atlassian.com"]) — when set, the
 *     hostname must end with one of these. When omitted, any
 *     non-private host passes.
 */
export async function assertSafeOutboundUrl(
  urlString: string,
  options: { allowedHostSuffixes?: ReadonlyArray<string> } = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new UnsafeOutboundUrlError("URL parse failed", "parse");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeOutboundUrlError("URL must be https://", "protocol");
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    throw new UnsafeOutboundUrlError("URL has no host", "no-host");
  }

  if (options.allowedHostSuffixes && options.allowedHostSuffixes.length > 0) {
    const allowed = options.allowedHostSuffixes.some((s) =>
      host === s.replace(/^\./, "") || host.endsWith(s),
    );
    if (!allowed) {
      throw new UnsafeOutboundUrlError(
        `Host ${host} not in allow-list`,
        "host-not-allowed",
      );
    }
  }

  // Block obvious literal-IP probes before DNS even runs.
  // Some Node versions return IPv6 hosts with the surrounding
  // brackets, others without — strip defensively.
  const bareHost = host.replace(/^\[/, "").replace(/\]$/, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bareHost)) {
    const v4 = isPrivateIpv4(bareHost);
    if (v4.blocked) {
      throw new UnsafeOutboundUrlError(
        `Literal IPv4 in private range: ${v4.reason}`,
        "private-ip-literal",
      );
    }
  }
  if (bareHost.includes(":")) {
    const v6 = isPrivateIpv6(bareHost);
    if (v6.blocked) {
      throw new UnsafeOutboundUrlError(
        `Literal IPv6 in private range: ${v6.reason}`,
        "private-ip-literal",
      );
    }
  }

  // Resolve and check every record. A hostname can return mixed
  // public + private (DNS rebinding); reject if any leg is private.
  let records: { address: string; family: number }[];
  try {
    records = await dnsLookup(host, { all: true });
  } catch {
    throw new UnsafeOutboundUrlError(
      `DNS lookup failed for ${host}`,
      "dns-fail",
    );
  }
  if (records.length === 0) {
    throw new UnsafeOutboundUrlError(
      `DNS returned no records for ${host}`,
      "dns-empty",
    );
  }
  for (const rec of records) {
    const check =
      rec.family === 4 ? isPrivateIpv4(rec.address) : isPrivateIpv6(rec.address);
    if (check.blocked) {
      throw new UnsafeOutboundUrlError(
        `${host} resolves to private address (${check.reason})`,
        "private-ip-resolved",
      );
    }
  }
}
