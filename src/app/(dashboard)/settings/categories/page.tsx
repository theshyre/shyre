import { redirect } from "next/navigation";

/** Back-compat redirect — /settings/categories moved to /categories. */
export default function CategoriesRedirect(): never {
  redirect("/categories");
}
