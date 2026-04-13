"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function switchOrgAction(formData: FormData): Promise<void> {
  const orgId = formData.get("org_id") as string;
  const cookieStore = await cookies();
  cookieStore.set("stint-org-id", orgId, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });
  redirect("/");
}
