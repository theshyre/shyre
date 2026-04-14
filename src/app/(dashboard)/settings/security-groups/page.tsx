import { redirect } from "next/navigation";

/** Back-compat redirect — /settings/security-groups moved to /security-groups. */
export default function SecurityGroupsRedirect(): never {
  redirect("/security-groups");
}
