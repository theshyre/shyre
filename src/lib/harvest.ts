/**
 * Harvest API v2 client for data import.
 * https://help.getharvest.com/api-v2/
 */

const HARVEST_API = "https://api.harvestapp.com/v2";

interface HarvestRequestOptions {
  token: string;
  accountId: string;
}

interface HarvestPaginatedResponse<T> {
  [key: string]: unknown;
  total_entries: number;
  per_page: number;
  total_pages: number;
  links: {
    first: string;
    next: string | null;
    previous: string | null;
    last: string;
  };
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
  created_at: string;
  updated_at: string;
}

async function harvestFetch<T>(
  path: string,
  opts: HarvestRequestOptions
): Promise<T> {
  const res = await fetch(`${HARVEST_API}${path}`, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      "Harvest-Account-Id": opts.accountId,
      "User-Agent": "Stint Import (stint.malcom.io)",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Harvest API error ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

async function fetchAllPages<T>(
  path: string,
  dataKey: string,
  opts: HarvestRequestOptions
): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = `${path}?per_page=100`;

  while (url) {
    const data = await harvestFetch<Record<string, unknown>>(url, opts);
    const items = data[dataKey] as T[] | undefined;
    if (items) all.push(...items);

    const links = data.links as { next: string | null } | undefined;
    if (links?.next) {
      // next URL is absolute — extract path
      const nextUrl = new URL(links.next);
      url = nextUrl.pathname + nextUrl.search;
    } else {
      url = null;
    }
  }

  return all;
}

export async function fetchHarvestClients(
  opts: HarvestRequestOptions
): Promise<HarvestClient[]> {
  return fetchAllPages<HarvestClient>("/clients", "clients", opts);
}

export async function fetchHarvestProjects(
  opts: HarvestRequestOptions
): Promise<HarvestProject[]> {
  return fetchAllPages<HarvestProject>("/projects", "projects", opts);
}

export async function fetchHarvestTimeEntries(
  opts: HarvestRequestOptions,
  params?: { from?: string; to?: string }
): Promise<HarvestTimeEntry[]> {
  let path = "/time_entries";
  const searchParams = new URLSearchParams();
  if (params?.from) searchParams.set("from", params.from);
  if (params?.to) searchParams.set("to", params.to);
  const qs = searchParams.toString();
  if (qs) path += `?${qs}`;

  return fetchAllPages<HarvestTimeEntry>(path, "time_entries", opts);
}

/**
 * Validate Harvest credentials by fetching the account info.
 */
export async function validateHarvestCredentials(
  opts: HarvestRequestOptions
): Promise<{ valid: boolean; companyName?: string; error?: string }> {
  try {
    const data = await harvestFetch<{ company: { name: string } }>(
      "/company",
      opts
    );
    return { valid: true, companyName: data.company.name };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Invalid credentials",
    };
  }
}
