CREATE OR REPLACE FUNCTION public.debug_change_primary(p_client_id UUID, p_new_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  current_primary UUID;
  current_role TEXT;
  member_count INT;
BEGIN
  SELECT organization_id INTO current_primary FROM public.clients WHERE id = p_client_id;
  SELECT role INTO current_role FROM public.organization_members
    WHERE organization_id = current_primary AND user_id = uid;
  SELECT count(*) INTO member_count FROM public.organization_members
    WHERE organization_id = current_primary AND user_id = uid;
  RETURN 'uid=' || COALESCE(uid::text, 'NULL')
    || ', primary=' || COALESCE(current_primary::text, 'NULL')
    || ', role=' || COALESCE(current_role, 'NULL')
    || ', member_count=' || member_count::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debug_change_primary(UUID, UUID) TO authenticated;
