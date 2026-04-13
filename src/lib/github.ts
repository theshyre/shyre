/**
 * GitHub API helpers.
 * Uses the user's personal access token stored in user_settings.
 */

const GITHUB_API = "https://api.github.com";

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

export async function fetchRepo(
  repo: string,
  token: string
): Promise<{ data: GitHubRepo | null; error: GitHubApiError | null }> {
  return githubFetch<GitHubRepo>(`/repos/${repo}`, token);
}

export async function validateRepo(
  repo: string,
  token: string
): Promise<boolean> {
  const { error } = await fetchRepo(repo, token);
  return error === null;
}
