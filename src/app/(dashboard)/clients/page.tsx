import { redirect } from "next/navigation";

/** Back-compat redirect — the old /clients route moved to /customers. */
export default function ClientsRedirect(): never {
  redirect("/customers");
}
