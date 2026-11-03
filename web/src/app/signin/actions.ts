"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, loadUsers } from "@/lib/basic-auth";
import { one } from "@/lib/db";
import { requestOrigin, safeLocalPath } from "@/lib/http";
import { recordLogin } from "@/lib/login-events";
import { clientInfo } from "@/lib/login-meta";
import { SESSION_COOKIE, SESSION_DAYS, loginTag, sessionKey, signSession } from "@/lib/session";
import { clearFailures, failureCount, isThrottled, noteFailure } from "@/lib/throttle";

/** Where to go after signing in: a local path only ("/x", never "//x" or another host). */
export async function safeNext(next: unknown): Promise<string> {
  const n = safeLocalPath(String(next ?? ""));
  return n.startsWith("/signin") ? "/" : n;
}

export async function signInAction(form: FormData) {
  const name = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const next = await safeNext(form.get("next"));
  const users = loadUsers(process.env);
  if (!users.size) redirect("/");
  const h = await headers();
  const ip = clientInfo(h).ip ?? "local", who = name.toLowerCase();
  // Blocks are per address, so nobody can lock a colleague out from elsewhere (SEC-025). Guesses at one
  // name from many addresses only get slower, and the right password still gets through.
  const ipKey = `signin-ip:${ip}`, pairKey = `signin-user:${who}:${ip}`, nameKey = `signin-name:${who}`;
  if (isThrottled(ipKey) || isThrottled(pairKey)) redirect(`/signin?${new URLSearchParams({ throttled: "1", next, username: name })}`);
  await new Promise((done) => setTimeout(done, Math.min(failureCount(nameKey) * 200, 2000)));
  const ok = checkPassword(users, name, password);
  // The sign-in log (step 24): who, from where, with what; failures too. A logging problem must
  // never keep an underwriter out, and a failed attempt only names a user that exists.
  await recordLogin(ok || users.has(name) ? name : "(unknown user)", ok, "signin", h).catch((err) => console.error("login-events: sign-in not recorded", err));
  if (!ok) {
    [ipKey, pairKey, nameKey].forEach((k) => noteFailure(k));
    redirect(`/signin?${new URLSearchParams({ error: "1", next, username: name })}`);
  }
  [pairKey, nameKey].forEach(clearFailures);
  const profile = await one<{ active: boolean; session_version: number }>("SELECT active, session_version FROM users WHERE username = $1", [name]);
  if (profile && !profile.active) redirect("/signin?disabled=1");
  const jar = await cookies();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const key = sessionKey(process.env);
  jar.set(SESSION_COOKIE, signSession(name, key, expires, profile?.session_version ?? 0, loginTag(name, password, key)), {
    httpOnly: true, sameSite: "lax", path: "/", expires, secure: requestOrigin(h).startsWith("https://"),
  });
  redirect(next);
}
