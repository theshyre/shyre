-- Two team-role transition RPCs the app surface needs but couldn't
-- safely express via direct UPDATE statements:
--
-- 1. `transfer_team_ownership(p_team_id, p_new_owner_user_id)` —
--    atomically demote the current owner to admin and promote the
--    target member to owner. Without atomicity there's a window
--    where the team has zero owners or two owners, both of which
--    break invariants other code relies on (RLS predicates that
--    look up "the" owner, ownership-required actions, etc).
--
-- 2. `update_team_member_role(p_team_id, p_member_id, p_new_role)` —
--    flip a non-owner member between `admin` and `member`. The
--    caller must be a current owner OR admin, and:
--      - the target member must NOT be the owner (use transfer
--        ownership for that),
--      - admins can demote other admins to member but cannot
--        promote a member to admin (audit-friendly: only the owner
--        confers admin-level capability),
--      - the caller cannot self-edit their own role (would let an
--        admin lock themselves out of admin or self-promote later).
--
-- Both functions are SECURITY DEFINER and validate the caller's
-- effective role explicitly so RLS bypass is safe. They raise
-- 42501 (insufficient_privilege) on auth failure so the server
-- action's runSafeAction wrapper can map them to user-visible
-- refusals consistently.

CREATE OR REPLACE FUNCTION public.transfer_team_ownership(
  p_team_id UUID,
  p_new_owner_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_user UUID := auth.uid();
  v_caller_role TEXT;
  v_target_member_id UUID;
  v_target_role TEXT;
  v_target_is_shell BOOLEAN;
BEGIN
  IF v_current_user IS NULL THEN
    RAISE EXCEPTION 'transfer_team_ownership: not authenticated'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = v_current_user THEN
    RAISE EXCEPTION 'transfer_team_ownership: cannot transfer to yourself'
      USING ERRCODE = '22023';
  END IF;

  -- Caller must be the current owner of the team.
  SELECT role
    INTO v_caller_role
  FROM public.team_members
  WHERE team_id = p_team_id
    AND user_id = v_current_user;

  IF v_caller_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION
      'transfer_team_ownership: only the current owner can transfer ownership'
      USING ERRCODE = '42501';
  END IF;

  -- Target must already be a member of the team.
  SELECT tm.id, tm.role, COALESCE(up.is_shell, FALSE)
    INTO v_target_member_id, v_target_role, v_target_is_shell
  FROM public.team_members tm
  LEFT JOIN public.user_profiles up
    ON up.user_id = tm.user_id
  WHERE tm.team_id = p_team_id
    AND tm.user_id = p_new_owner_user_id;

  IF v_target_member_id IS NULL THEN
    RAISE EXCEPTION
      'transfer_team_ownership: target user is not a member of this team'
      USING ERRCODE = '22023';
  END IF;

  -- Shell accounts (imported anchors that can't sign in) cannot
  -- become owners — they wouldn't be able to act on the team.
  IF v_target_is_shell THEN
    RAISE EXCEPTION
      'transfer_team_ownership: target is a shell account and cannot own a team'
      USING ERRCODE = '22023';
  END IF;

  -- Atomic role swap. The CHECK constraint on team_members.role only
  -- allows ('owner','admin','member'); transient duplicate-owner
  -- state is avoided by demoting the current owner first and then
  -- promoting the target inside one transaction.
  UPDATE public.team_members
     SET role = 'admin'
   WHERE team_id = p_team_id
     AND user_id = v_current_user;

  UPDATE public.team_members
     SET role = 'owner'
   WHERE id = v_target_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_team_ownership FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_team_ownership TO authenticated;

COMMENT ON FUNCTION public.transfer_team_ownership IS
  'Atomically demote the current owner of `p_team_id` to admin and promote `p_new_owner_user_id` to owner. Caller must be the current owner. Refuses shell accounts and self-transfer.';


CREATE OR REPLACE FUNCTION public.update_team_member_role(
  p_team_id UUID,
  p_member_id UUID,
  p_new_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_user UUID := auth.uid();
  v_caller_role TEXT;
  v_target_role TEXT;
  v_target_user_id UUID;
  v_target_team_id UUID;
BEGIN
  IF v_current_user IS NULL THEN
    RAISE EXCEPTION 'update_team_member_role: not authenticated'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION
      'update_team_member_role: new role must be ''admin'' or ''member'' (use transfer_team_ownership for owner)'
      USING ERRCODE = '22023';
  END IF;

  -- Caller's role on the team.
  SELECT role
    INTO v_caller_role
  FROM public.team_members
  WHERE team_id = p_team_id
    AND user_id = v_current_user;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION
      'update_team_member_role: only owners and admins can change roles'
      USING ERRCODE = '42501';
  END IF;

  -- Target row.
  SELECT role, user_id, team_id
    INTO v_target_role, v_target_user_id, v_target_team_id
  FROM public.team_members
  WHERE id = p_member_id;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'update_team_member_role: member not found'
      USING ERRCODE = '22023';
  END IF;
  IF v_target_team_id IS DISTINCT FROM p_team_id THEN
    RAISE EXCEPTION 'update_team_member_role: member does not belong to this team'
      USING ERRCODE = '22023';
  END IF;

  -- Owner role can't be edited via this RPC — that path is the
  -- transfer flow.
  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION
      'update_team_member_role: cannot change the owner role here. Use transfer_team_ownership.'
      USING ERRCODE = '42501';
  END IF;

  -- Self-edits forbidden — would let admins lock themselves out of
  -- admin or, conversely, self-promote later. Owners can't self-
  -- edit either via this path (they're already owner; they'd use
  -- transfer ownership to leave the role).
  IF v_target_user_id = v_current_user THEN
    RAISE EXCEPTION
      'update_team_member_role: you cannot change your own role'
      USING ERRCODE = '42501';
  END IF;

  -- Audit-friendly asymmetry: only the owner can grant `admin`.
  -- Admins can demote other admins to `member` (operations cleanup
  -- when one of them is leaving), but they cannot create new
  -- admins. This keeps the privilege boundary visible — every
  -- admin in the team was admitted by the owner.
  IF p_new_role = 'admin' AND v_caller_role <> 'owner' THEN
    RAISE EXCEPTION
      'update_team_member_role: only the owner can promote members to admin'
      USING ERRCODE = '42501';
  END IF;

  -- No-op short-circuit so the caller doesn't have to check.
  IF v_target_role = p_new_role THEN
    RETURN;
  END IF;

  UPDATE public.team_members
     SET role = p_new_role
   WHERE id = p_member_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_team_member_role FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_team_member_role TO authenticated;

COMMENT ON FUNCTION public.update_team_member_role IS
  'Change a non-owner member''s role between admin and member. Owner-only for promote-to-admin (audit-friendly); admins can demote other admins. Refuses self-edits and owner-row edits. Use transfer_team_ownership to change the owner.';
