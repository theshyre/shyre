import { redirect } from "next/navigation";

/**
 * The old /settings URL is kept for bookmark back-compat. Personal settings
 * now live at /profile; org-admin concerns have their own dedicated pages
 * (security-groups, categories, templates, import, teams).
 */
export default function SettingsRedirect(): never {
  redirect("/profile");
}
