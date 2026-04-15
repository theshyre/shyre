import { redirect } from "next/navigation";

/**
 * Back-compat: the single-team `/business/info` page is gone; identity now
 * lives at `/business/[id]/identity` for each business. Send the user
 * to the businesses list to pick one.
 */
export default function BusinessInfoRedirect(): never {
  redirect("/business");
}
