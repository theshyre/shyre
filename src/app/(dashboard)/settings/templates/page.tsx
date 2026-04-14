import { redirect } from "next/navigation";

/** Back-compat redirect — /settings/templates moved to /templates. */
export default function TemplatesRedirect(): never {
  redirect("/templates");
}
