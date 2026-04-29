import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** A shell account is created for the duration of an import to anchor
 *  time entries from a Harvest user who won't sign in to Shyre. The
 *  account stays in `auth.users` so existing FK constraints + display
 *  surfaces (avatar, author rendering, reports) all just work — what
 *  marks it as inaccessible is the metadata flag below + a randomized
 *  password the person is never given. */

/** Marker stored on `auth.users.user_metadata` so UIs and queries can
 *  filter shell accounts out of "active member" surfaces (invite
 *  suggestion dropdowns, member-rate setters, permission pickers). */
export const SHELL_ACCOUNT_METADATA_KEY = "shell_account" as const;

export interface ShellAccountMetadata {
  /** Always true for rows created by this helper. */
  shell_account: true;
  /** Source system that produced the historical data. Today only
   *  Harvest; future imports (Toggl, Clockify, etc.) reuse the same
   *  shape with a different value. */
  imported_from: "harvest";
  /** Source-system user id, for idempotency lookups on re-import. */
  source_user_id: string;
  /** The Shyre team this shell account was created for. A shell user
   *  belongs to exactly one team — they exist to anchor that team's
   *  history, not to be a multi-team identity. */
  shell_team_id: string;
  /** Display name copied from the source system at creation time.
   *  user_profiles.display_name is the live source of truth; this
   *  stays static as a debugging breadcrumb. */
  shell_display_name: string;
}

/** Build the non-deliverable email used for shell accounts. Scoped to
 *  source + source-user-id + team so re-imports of the same person
 *  into a different team produce a different shell account, and so
 *  no two teams share an auth.users row by accident. The
 *  `imported.shyre.invalid` TLD is reserved per RFC 6761 — never
 *  resolves, never bounces a real inbox. */
export function buildShellAccountEmail(args: {
  source: "harvest";
  sourceUserId: string;
  teamId: string;
}): string {
  return `${args.source}+${args.sourceUserId}-${args.teamId}@imported.shyre.invalid`;
}

/** Build the metadata blob for a freshly-created shell account.
 *  Pure helper — kept separate from the DB write so tests can pin
 *  the shape without round-tripping through Supabase. */
export function buildShellAccountMetadata(args: {
  source: "harvest";
  sourceUserId: string;
  teamId: string;
  displayName: string;
}): ShellAccountMetadata {
  return {
    [SHELL_ACCOUNT_METADATA_KEY]: true,
    imported_from: args.source,
    source_user_id: args.sourceUserId,
    shell_team_id: args.teamId,
    shell_display_name: args.displayName,
  };
}

/** True iff the user_metadata blob marks the account as a shell.
 *  Predicate kept separate so non-server callers (filter helpers in
 *  team detail page) can use it without importing the admin client. */
export function isShellAccountMetadata(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  return (metadata as Record<string, unknown>)[SHELL_ACCOUNT_METADATA_KEY] === true;
}

/**
 * Materialize a single Harvest user into a Shyre shell auth account.
 *
 * Idempotency: looks up an existing shell account for this team +
 * source_user_id by querying user_profiles joined with the metadata
 * stored on auth.users. If one exists the user_id is returned
 * unchanged; otherwise a fresh auth user is created, user_profiles is
 * stamped with the display name, and a `team_members` row is inserted
 * with role=member.
 *
 * Returns the shell user's `user_id` ready for use as
 * `time_entries.user_id`.
 *
 * Requires the admin client (service role) — only callable from
 * server-side import code.
 */
export async function materializeHarvestShellAccount(
  admin: SupabaseClient,
  args: {
    teamId: string;
    harvestUserId: number;
    displayName: string;
  },
): Promise<string> {
  const sourceUserId = String(args.harvestUserId);
  const email = buildShellAccountEmail({
    source: "harvest",
    sourceUserId,
    teamId: args.teamId,
  });

  // Idempotency: re-runs of the same import shouldn't create
  // duplicate shell accounts. Look up by the deterministic email
  // (cheaper than scanning user_metadata server-side). listUsers is
  // capped to 1000 per page; this account size is fine for an
  // import-scoped lookup.
  const { data: existingList, error: listErr } =
    await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) {
    throw new Error(`listUsers failed: ${listErr.message}`);
  }
  const existing = existingList.users.find((u) => u.email === email);
  if (existing) {
    return existing.id;
  }

  const metadata = buildShellAccountMetadata({
    source: "harvest",
    sourceUserId,
    teamId: args.teamId,
    displayName: args.displayName,
  });

  const { data: createRes, error: createErr } =
    await admin.auth.admin.createUser({
      email,
      password: crypto.randomUUID(),
      email_confirm: true,
      user_metadata: metadata,
    });
  if (createErr || !createRes.user) {
    throw new Error(
      `Shell account create failed for Harvest user ${args.harvestUserId}: ${createErr?.message ?? "no user returned"}`,
    );
  }
  const userId = createRes.user.id;

  // user_profiles.display_name is the live source of truth that the
  // avatar + name renderers read. The auth row's metadata captures the
  // same name as a frozen breadcrumb; profile is what UIs see.
  // is_shell mirrors the auth metadata flag so RLS-scoped queries
  // (team detail page, invite suggestion picker) can filter without
  // having to read auth.users via the admin client.
  const { error: profileErr } = await admin
    .from("user_profiles")
    .update({ display_name: args.displayName, is_shell: true })
    .eq("user_id", userId);
  if (profileErr) {
    throw new Error(`user_profiles update failed: ${profileErr.message}`);
  }

  const { error: memberErr } = await admin.from("team_members").insert({
    team_id: args.teamId,
    user_id: userId,
    role: "member",
  });
  if (memberErr) {
    throw new Error(`team_members insert failed: ${memberErr.message}`);
  }

  return userId;
}
