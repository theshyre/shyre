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

/** How long to sleep on a 429 before retrying, in ms. Exponential
 * backoff: 1s, 2s, 4s, then give up. Harvest's published rate is 100
 * requests per 15 seconds, so a 15-second wait is also sometimes
 * needed — we use the Retry-After header when present. */
const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  throw new Error(`Harvest API error ${lastStatus}: ${lastBody}`);
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
      // next URL is absolute — extract pathname+search (already carries
      // per_page + any filters we sent).
      const nextUrl = new URL(links.next);
      url = nextUrl.pathname + nextUrl.search;
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
