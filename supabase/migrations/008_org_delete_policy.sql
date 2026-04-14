-- Add DELETE policy for organizations so owners can delete their orgs.
-- Previously only UPDATE policy existed, causing silent delete failures.

CREATE POLICY "Owners can delete their organizations"
  ON organizations FOR DELETE
  USING (public.user_org_role(id) = 'owner');
