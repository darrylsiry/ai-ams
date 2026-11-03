"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnPath } from "@/lib/http";
import { USER_COOKIE, authEnabled } from "@/lib/user";

/** Local development only (no password gate): switch which profile you are working as. */
export async function setUserAction(form: FormData) {
  if (authEnabled() || process.env.NODE_ENV === "production") return;
  const name = String(form.get("username") ?? "").trim();
  (await cookies()).set(USER_COOKIE, name, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  const h = await headers();
  redirect(safeReturnPath(h.get("referer"), h.get("host"), "/"));
}
