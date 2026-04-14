import { redirect } from "next/navigation";

/** Back-compat redirect — /settings/import moved to /import. */
export default function ImportRedirect(): never {
  redirect("/import");
}
