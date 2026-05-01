/**
 * Harvest API v2 client for data import.
 * https://help.getharvest.com/api-v2/
 *
 * Handles pagination, 429 rate limits (Harvest returns ~100 req / 15s
 * on the public REST API; sustained imports routinely hit the cap),
 * and the one non-obvious field mapping — `user` on each time_entry
 * is the Harvest user who logged the entry, which the importer needs
 * to resolve against Shyre team members rather than blanket-attributing
 * to the caller.
 */

const HARVEST_API = "https://api.harvestapp.com/v2";

interface HarvestRequestOptions {
  token: string;
  accountId: string;
}

export interface HarvestClient {
  id: number;
  name: string;
  currency: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface HarvestProject {
  id: number;
  name: string;
  code: string | null;
  is_active: boolean;
  is_billable: boolean;
  budget: number | null;
  budget_by: string;
  hourly_rate: number | null;
  notes: string | null;
  client: { id: number; name: string };
  created_at: string;
  updated_at: string;
}

export interface HarvestTimeEntry {
  id: number;
  spent_date: string;
  hours: number;
  notes: string | null;
  is_locked: boolean;
  is_running: boolean;
  billable: boolean;
  billable_rate: number | null;
  started_time: string | null;
  ended_time: string | null;
  project: { id: number; name: string };
  client: { id: number; name: string };
  task: { id: number; name: string };
  user: { id: number; name: string };
  /** Set when this entry has been invoiced in Harvest. The importer
   *  uses this to backfill time_entries.invoice_id + invoiced=true so
   *  Shyre's "billable but not yet invoiced" filter stays accurate. */
  invoice: { id: number; number: string } | null;
  /** Harvest's structured pointer at an external ticket / issue
   *  (Jira, GitHub, Trello, Asana, etc.) when the user attached one
   *  via Harvest's integrations. Authoritative — trumps text-parsing
   *  the description for ticket keys, since Harvest's value links
   *  even when the description doesn't repeat the key. `service`
   *  matches Harvest's slugs ("jira", "github", "trello", …);
   *  `permalink` is the deep-link to the issue in the source system.
   *  Null for entries logged without an integration. */
  external_reference: {
    id: string;
    group_id: string | null;
    permalink: string | null;
    service: string | null;
    service_icon_url: string | null;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface HarvestUser {
  id: number;
  first_name: string;
  last_name: string;
  email: string | null;
  is_active: boolean;
}

export interface HarvestCompany {
  name: string;
  /** IANA time-zone id, e.g. "America/New_York". Harvest returns this
   * on the /company endpoint and it governs how `started_time` /
   * `ended_time` on time entries should be interpreted. */
  time_zone: string;
  week_start_day: string;
}

/** A line on a Harvest invoice. Harvest's API returns these inline on
 *  the invoice payload (no separate /v2/invoice_line_items endpoint). */
export interface HarvestInvoiceLineItem {
  id: number;
  /** Free-text "kind" label set in Harvest (e.g. "Service", "Product").
   *  Stored as part of the description if non-default. */
  kind: string | null;
  description: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  taxed: boolean;
  taxed2: boolean;
  /** Harvest sets this when the line was generated from time entries
   *  on a particular project. We don't currently store the link
   *  explicitly — time entries link back via their own `invoice` field. */
  project: { id: number; name: string } | null;
}

/** A Harvest invoice. State values seen in the wild: 'draft', 'open',
 *  'paid', 'closed'. Harvest also has 'written-off' but it's rare. */
export interface HarvestInvoice {
  id: number;
  /** Harvest's invoice number (string, may include letters/dashes). */
  number: string;
  client: { id: number; name: string };
  amount: number;
  due_amount: number;
  currency: string;
  state: string;
  issue_date: string | null;
  due_date: string | null;
  sent_at: string | null;
  paid_at: string | null;
  paid_date: string | null;
  notes: string | null;
  subject: string | null;
  /** Tax percentage on the invoice (e.g. 8.25 for 8.25%). */
  tax: number | null;
  tax_amount: number;
  tax2: number | null;
  tax2_amount: number;
  /** Discount percentage (0-100) when the user set a percentage on
   *  the Harvest invoice. NULL when no discount or when the user
   *  set a flat discount amount via the UI. */
  discount: number | null;
  /** Computed discount in dollars. Set whenever Harvest's invoice
   *  carries a discount, regardless of whether `discount` (rate)
   *  is set. Drove a real import bug: a 100%-discount invoice
   *  imported as $0 across the board with no record. */
  discount_amount: number;
  line_items: HarvestInvoiceLineItem[];
  created_at: string;
  updated_at: string;
}

/** How long to sleep on a 429 before retrying, in ms. Exponential
 * backoff: 1s, 2s, 4s, then give up. Harvest's published rate is 100
 * requests per 15 seconds, so a 15-second wait is also sometimes
 * needed — we use the Retry-After header when present. */
const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Structured Harvest-client error. Carries a clean user-facing
 * message (classified from the HTTP status) and a separate capped
 * diagnostic payload (the raw response, trimmed) for the "Copy
 * details" flow in the UI. The route converts this into the JSON
 * error body; the UI renders both pieces via `InlineErrorCard`.
 */
export class HarvestApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly rawBody: string;
  readonly kind:
    | "unauthorized"
    | "forbidden"
    | "not_found"
    | "rate_limited"
    | "bad_request"
    | "server_error"
    | "unknown";

  constructor(opts: {
    status: number;
    endpoint: string;
    rawBody: string;
  }) {
    const kind = classifyHarvestStatus(opts.status);
    super(userFacingMessage(kind, opts.status));
    this.name = "HarvestApiError";
    this.status = opts.status;
    this.endpoint = opts.endpoint;
    this.rawBody = opts.rawBody;
    this.kind = kind;
  }
}

function classifyHarvestStatus(
  status: number,
): HarvestApiError["kind"] {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "bad_request";
  if (status >= 500) return "server_error";
  return "unknown";
}

function userFacingMessage(
  kind: HarvestApiError["kind"],
  status: number,
): string {
  switch (kind) {
    case "unauthorized":
      return "Harvest rejected the credentials. Check that the personal access token is valid and that the Account ID matches the account that issued the token.";
    case "forbidden":
      return "Harvest denied access to that resource. The token might lack the required scope (need access to time entries, projects, and clients).";
    case "not_found":
      return "Harvest returned 404. If the credentials are correct this is a Shyre bug — the importer is calling an endpoint Harvest doesn't have.";
    case "rate_limited":
      return "Harvest is rate-limiting the import. Shyre will retry automatically; if this persists, wait a minute and try again.";
    case "bad_request":
      return "Harvest rejected the request. Check the date range and any filters you set.";
    case "server_error":
      return `Harvest's servers returned a ${status}. This is usually transient — try again in a minute.`;
    default:
      return `Harvest returned an unexpected ${status}.`;
  }
}

/** Trim raw response bodies so a giant HTML error page doesn't land
 * on the wire or in the UI. The first ~2 KB is plenty to identify
 * the failure during support. */
function cappedBody(body: string, max = 2000): string {
  if (body.length <= max) return body;
  return `${body.slice(0, max)}\n…[truncated, ${body.length - max} bytes]`;
}

async function harvestFetch<T>(
  path: string,
  opts: HarvestRequestOptions,
): Promise<T> {
  let lastBody = "";
  let lastStatus = 0;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(`${HARVEST_API}${path}`, {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        "Harvest-Account-Id": opts.accountId,
        "User-Agent": "Shyre Import (shyre.malcom.io)",
        "Content-Type": "application/json",
      },
    });

    if (res.ok) {
      return res.json() as Promise<T>;
    }

    lastStatus = res.status;
    lastBody = await res.text();

    // 429 Too Many Requests — back off and retry.
    // 503 Service Unavailable — transient; retry a few times.
    if (
      (res.status === 429 || res.status === 503) &&
      attempt < RETRY_DELAYS_MS.length
    ) {
      const retryAfterHeader = res.headers.get("retry-after");
      const retryAfterMs = retryAfterHeader
        ? Number(retryAfterHeader) * 1000
        : RETRY_DELAYS_MS[attempt];
      await sleep(retryAfterMs ?? 1000);
      continue;
    }

    break;
  }

  throw new HarvestApiError({
    status: lastStatus,
    endpoint: path.split("?")[0] ?? path,
    rawBody: cappedBody(lastBody),
  });
}

/**
 * Build the initial paginated-list URL with per_page + any caller-
 * supplied filters merged into one query string. Exported for a
 * regression test: a previous version manually concatenated
 * `?per_page=100` on top of a path that already carried `?from=...`,
 * producing URLs with two `?` characters that Harvest parsed as a
 * malformed `from` field.
 */
export function buildInitialPageUrl(
  path: string,
  extraParams: Record<string, string> = {},
): string {
  const searchParams = new URLSearchParams({
    per_page: "100",
    ...extraParams,
  });
  return `${path}?${searchParams.toString()}`;
}

async function fetchAllPages<T>(
  path: string,
  dataKey: string,
  opts: HarvestRequestOptions,
  extraParams: Record<string, string> = {},
): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = buildInitialPageUrl(path, extraParams);

  while (url) {
    const data = await harvestFetch<Record<string, unknown>>(url, opts);
    const items = data[dataKey] as T[] | undefined;
    if (items) all.push(...items);

    const links = data.links as { next: string | null } | undefined;
    if (links?.next) {
      // next URL is absolute (e.g. https://api.harvestapp.com/v2/time_entries?cursor=...).
      // Extract pathname+search and strip the "/v2" prefix — harvestFetch
      // concatenates with HARVEST_API which already ends in "/v2", so a
      // raw pathname produced "/v2/v2/time_entries?cursor=..." and Harvest's
      // gateway dropped to its marketing 404 page (which we couldn't
      // distinguish from "wrong Account-Id" until we logged the URL).
      const nextUrl = new URL(links.next);
      const stripped = nextUrl.pathname.replace(/^\/v2(?=\/)/, "");
      url = stripped + nextUrl.search;
    } else {
      url = null;
    }
  }

  return all;
}

export async function fetchHarvestClients(
  opts: HarvestRequestOptions,
): Promise<HarvestClient[]> {
  // Harvest's API endpoint is /v2/clients and the response envelope
  // key is "clients". When Shyre renamed its own internal concept
  // from `clients` → `customers`, an over-broad search-and-replace
  // hit the Harvest API URL here too and returned 404 against
  // https://api.harvestapp.com/v2/customers. Endpoint + key are
  // part of Harvest's contract, not Shyre's vocabulary — they stay
  // "clients" regardless of what we call them internally.
  return fetchAllPages<HarvestClient>("/clients", "clients", opts);
}

export async function fetchHarvestProjects(
  opts: HarvestRequestOptions,
): Promise<HarvestProject[]> {
  return fetchAllPages<HarvestProject>("/projects", "projects", opts);
}

export async function fetchHarvestTimeEntries(
  opts: HarvestRequestOptions,
  params?: { from?: string; to?: string },
): Promise<HarvestTimeEntry[]> {
  // Pass filters through to fetchAllPages so they merge into a single
  // query string with per_page. Building `/time_entries?from=...` and
  // letting fetchAllPages append `?per_page=100` produced a URL with
  // two `?`s that Harvest parsed as a malformed `from` value — see
  // comment in fetchAllPages.
  const extraParams: Record<string, string> = {};
  if (params?.from) extraParams.from = params.from;
  if (params?.to) extraParams.to = params.to;
  return fetchAllPages<HarvestTimeEntry>(
    "/time_entries",
    "time_entries",
    opts,
    extraParams,
  );
}

export async function fetchHarvestUsers(
  opts: HarvestRequestOptions,
): Promise<HarvestUser[]> {
  return fetchAllPages<HarvestUser>("/users", "users", opts);
}

export async function fetchHarvestInvoices(
  opts: HarvestRequestOptions,
  params?: { from?: string; to?: string },
): Promise<HarvestInvoice[]> {
  // /v2/invoices supports `from` and `to` against issue_date. We pass
  // them through the same way time-entry filtering does so a single
  // query string gets built (avoiding the double-`?` bug fixed in
  // fetchAllPages for time entries).
  const extraParams: Record<string, string> = {};
  if (params?.from) extraParams.from = params.from;
  if (params?.to) extraParams.to = params.to;
  return fetchAllPages<HarvestInvoice>(
    "/invoices",
    "invoices",
    opts,
    extraParams,
  );
}

/**
 * A payment recorded against a Harvest invoice.
 *
 * Lives at `/v2/invoices/{INVOICE_ID}/payments`, not on the invoice
 * payload itself — the invoice's `paid_at` field is just "the date a
 * user clicked Mark as Paid" and gets stamped to midnight UTC of
 * that date when the user marks paid via Harvest's date picker. The
 * actual recorded-at timestamp + amount + recorder live in this
 * separate resource. Importing them is what gives the activity log
 * accurate "Payment received" events instead of midnight stamps.
 */
export interface HarvestInvoicePayment {
  id: number;
  amount: number;
  paid_at: string | null;
  paid_date: string | null;
  recorded_by: string | null;
  recorded_by_email: string | null;
  notes: string | null;
  transaction_id: string | null;
  payment_gateway: { id: number | null; name: string | null } | null;
  created_at: string;
  updated_at: string;
}

export async function fetchHarvestInvoicePayments(
  invoiceId: number,
  opts: HarvestRequestOptions,
): Promise<HarvestInvoicePayment[]> {
  return fetchAllPages<HarvestInvoicePayment>(
    `/invoices/${invoiceId}/payments`,
    "invoice_payments",
    opts,
  );
}

/**
 * A message (send / reminder / thank-you) recorded against a Harvest
 * invoice. Lives at `/v2/invoices/{INVOICE_ID}/messages`. We use it to
 * pull the recipient out of the most recent `event_type=null` (default
 * send) message, which is what feeds Harvest's "Sent invoice to X
 * <Y>" activity-log line.
 *
 * `event_type` is null for a normal send, or one of "send", "view",
 * "reminder", "thank_you" depending on the action. The default-send
 * is what we display.
 */
export interface HarvestInvoiceMessageRecipient {
  name: string | null;
  email: string;
}

export interface HarvestInvoiceMessage {
  id: number;
  sent_by: string | null;
  sent_by_email: string | null;
  sent_from: string | null;
  sent_from_email: string | null;
  recipients: HarvestInvoiceMessageRecipient[];
  subject: string | null;
  body: string | null;
  include_link_to_client_invoice: boolean;
  attach_pdf: boolean;
  send_me_a_copy: boolean;
  thank_you: boolean;
  /** Null for the default "send" event; otherwise "send", "view",
   *  "reminder", "thank_you", or future Harvest event types. */
  event_type: string | null;
  reminder: boolean;
  send_reminder_on: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchHarvestInvoiceMessages(
  invoiceId: number,
  opts: HarvestRequestOptions,
): Promise<HarvestInvoiceMessage[]> {
  return fetchAllPages<HarvestInvoiceMessage>(
    `/invoices/${invoiceId}/messages`,
    "invoice_messages",
    opts,
  );
}

/**
 * Fetch the Harvest account's company info. Used for two things:
 * (1) validating credentials, (2) pulling the account's time zone so
 * time entries can be localized correctly.
 */
export async function fetchHarvestCompany(
  opts: HarvestRequestOptions,
): Promise<HarvestCompany> {
  return harvestFetch<HarvestCompany>("/company", opts);
}

/**
 * Validate Harvest credentials by fetching the account info.
 */
export async function validateHarvestCredentials(
  opts: HarvestRequestOptions,
): Promise<{
  valid: boolean;
  companyName?: string;
  timeZone?: string;
  error?: string;
}> {
  try {
    const data = await fetchHarvestCompany(opts);
    return {
      valid: true,
      companyName: data.name,
      timeZone: data.time_zone,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Invalid credentials",
    };
  }
}
