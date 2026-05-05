/**
 * GitHub API helpers.
 * Uses the user's personal access token stored in user_settings.
 */

const GITHUB_API = "https://api.github.com";

const REPO_REGEX = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** Returns true if `repo` is a syntactically valid GitHub `owner/name`
 *  pair. Library callers should pre-validate with this; the lib itself
 *  also asserts on every entry point so a malformed value can never
 *  smuggle a sub-path into a `/repos/${repo}/...` interpolation.
 *
 *  GitHub also disallows `..` and segments starting with `.` — those
 *  are explicit path-traversal shapes that the broad character class
 *  would otherwise let through (e.g., `../user`). */
export function isValidGithubRepo(repo: string): boolean {
  if (!REPO_REGEX.test(repo)) return false;
  if (repo.includes("..")) return false;
  const [owner, name] = repo.split("/");
  if (!owner || !name) return false;
  if (owner.startsWith(".") || name.startsWith(".")) return false;
  return true;
}

const INVALID_REPO_ERROR = {
  message: "Invalid repository identifier",
  status: 400,
} as const;

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  labels: Array<{ name: string; color: string }>;
  html_url: string;
}

export interface GitHubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  open_issues_count: number;
}

interface GitHubApiError {
  message: string;
  status: number;
}

async function githubFetch<T>(
  path: string,
  token: string
): Promise<{ data: T | null; error: GitHubApiError | null }> {
  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return {
        data: null,
        error: { message: res.statusText, status: res.status },
      };
    }

    const data = (await res.json()) as T;
    return { data, error: null };
  } catch (err) {
    return {
      data: null,
      error: {
        message: err instanceof Error ? err.message : "Unknown error",
        status: 0,
      },
    };
  }
}

export async function fetchIssues(
  repo: string,
  token: string,
  options?: { state?: "open" | "closed" | "all"; query?: string }
): Promise<{ data: GitHubIssue[] | null; error: GitHubApiError | null }> {
  if (!isValidGithubRepo(repo)) {
    return { data: null, error: { ...INVALID_REPO_ERROR } };
  }
  const state = options?.state ?? "open";
  const params = new URLSearchParams({
    state,
    per_page: "50",
    sort: "updated",
    direction: "desc",
  });

  const result = await githubFetch<GitHubIssue[]>(
    `/repos/${repo}/issues?${params.toString()}`,
    token
  );

  // Filter by query client-side if provided
  if (result.data && options?.query) {
    const q = options.query.toLowerCase();
    result.data = result.data.filter(
      (issue) =>
        issue.title.toLowerCase().includes(q) ||
        String(issue.number).includes(q)
    );
  }

  return result;
}

export interface GitHubIssueDetail {
  number: number;
  title: string;
  state: string;
  html_url: string;
}

/** Fetch a single issue (or PR — same endpoint) by repo + number.
 *  Used by the ticket-link lookup so we never download the entire
 *  issue list when all we want is one title. */
export async function fetchSingleIssue(
  repo: string,
  number: number,
  token: string,
): Promise<{ data: GitHubIssueDetail | null; error: GitHubApiError | null }> {
  if (!isValidGithubRepo(repo)) {
    return { data: null, error: { ...INVALID_REPO_ERROR } };
  }
  return githubFetch<GitHubIssueDetail>(
    `/repos/${repo}/issues/${number}`,
    token,
  );
}

export async function fetchRepo(
  repo: string,
  token: string
): Promise<{ data: GitHubRepo | null; error: GitHubApiError | null }> {
  if (!isValidGithubRepo(repo)) {
    return { data: null, error: { ...INVALID_REPO_ERROR } };
  }
  return githubFetch<GitHubRepo>(`/repos/${repo}`, token);
}

export async function validateRepo(
  repo: string,
  token: string
): Promise<boolean> {
  const { error } = await fetchRepo(repo, token);
  return error === null;
}
