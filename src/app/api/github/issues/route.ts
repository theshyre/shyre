import { createClient } from "@/lib/supabase/server";
import { fetchIssues } from "@/lib/github";
import { logError } from "@/lib/logger";
import { NextResponse } from "next/server";

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get("repo");
  const query = searchParams.get("q") ?? undefined;

  if (!repo) {
    return NextResponse.json(
      { error: "Missing repo parameter" },
      { status: 400 }
    );
  }

  // Repo must be owner/name with GitHub-allowed chars only. Anything
  // else lets the caller re-target the GitHub API path with their PAT
  // (e.g., `repo=foo/bar/issues/1?` smuggles a sub-path).
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) {
    return NextResponse.json(
      { error: "Invalid repo format. Expected owner/name." },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get the user's GitHub token
  const { data: settings } = await supabase
    .from("user_settings")
    .select("github_token")
    .eq("user_id", user.id)
    .single();

  if (!settings?.github_token) {
    return NextResponse.json(
      { error: "No GitHub token configured. Add one in Settings." },
      { status: 400 }
    );
  }

  const { data, error } = await fetchIssues(repo, settings.github_token, {
    query,
  });

  if (error) {
    logError(error instanceof Error ? error : new Error(error.message), {
      userId: user.id,
      url: "/api/github/issues",
      action: "fetchGithubIssues",
    });
    return NextResponse.json(
      { error: error.message },
      { status: error.status || 500 }
    );
  }

  return NextResponse.json({ issues: data });
}
