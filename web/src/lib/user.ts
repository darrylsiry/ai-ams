import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_USER_HEADER, loadUsers, bootstrapAdmin } from "./basic-auth";
import { db, one, q } from "./db";
import { ROLE_LABEL } from "./roles";

// Who is working. On a deployment with logins (BASIC_AUTH_USERS, as in the Underwriting Desktop) it is
// the user middleware.ts authenticated; locally, where the password gate is off, it is the profile
// picked in the header's "Working as" menu and kept in a cookie. Either way the name resolves to a
// row in `users`, which carries the role, branch and email-forwarding alias.

export const USER_COOKIE = "ams_user";
export const DEFAULT_LOCAL_USER = "mrivera";

export type Role = "admin" | "principal" | "account_manager" | "csr" | "producer" | "accounting" | "readonly";

export type User = {
  id: number; username: string; full_name: string; email: string; title: string | null; role: Role;
  branch_id: number | null; can_view_pii: boolean; inbox_alias: string; color: string; active: boolean;
};

export { ROLE_LABEL };

/** The name middleware authenticated, or null when the password gate is off (local development). */
export async function signedInUser(): Promise<string | null> {
  return (await headers()).get(AUTH_USER_HEADER);
}

export const authEnabled = () => loadUsers(process.env).size > 0;

const COLS = "id, username, full_name, email, title, role, branch_id, can_view_pii, inbox_alias, color, active";

/**
 * The current user's profile. A login with no profile yet gets one (role CSR, which an admin can
 * change), so a newly issued password works the first time it is used. On a database with no
 * administrator, the bootstrap login becomes one, or nobody could ever hand out roles (CR-029).
 */
export const currentUser = cache(async (): Promise<User> => {
  const signed = await signedInUser();
  const name = signed ?? ((await cookies()).get(USER_COOKIE)?.value || DEFAULT_LOCAL_USER);
  let u = await one<User>(`SELECT ${COLS} FROM users WHERE username = $1`, [name]);
  // Deactivated means no access (SEC-003, CR-014). Middleware refuses them first; this covers anything it can't see.
  if (u && !u.active && signed) redirect("/signin?disabled=1");
  if ((!u || !u.active) && !signed) u = await one<User>(`SELECT ${COLS} FROM users WHERE active ORDER BY (role = 'account_manager') DESC, id LIMIT 1`);
  if (!u) {
    u = await one<User>(
      `INSERT INTO users (username, full_name, email, role, inbox_alias)
       VALUES ($1, $1, $1 || '@unknown.local', CASE WHEN $2 AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND active) THEN 'admin' ELSE 'csr' END, $1)
       ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING ${COLS}`, [name, name === bootstrapAdmin(process.env)]);
  }
  db.query("UPDATE users SET last_active_at = now() WHERE id = $1 AND (last_active_at IS NULL OR last_active_at < now() - interval '2 minutes')", [u!.id]).catch(() => {});
  return u!;
});

export async function activeUsers(): Promise<User[]> {
  return q<User>(`SELECT ${COLS} FROM users WHERE active ORDER BY full_name`);
}

export { can, mayActOn, type Permission } from "./permissions";
import { can, type Permission } from "./permissions";

export class Forbidden extends Error {}

/** Throw unless the current user holds `p`; server actions call this first. */
export async function requirePerm(p: Permission): Promise<User> {
  const u = await currentUser();
  if (!can(u, p)) throw new Forbidden(`Your role (${ROLE_LABEL[u.role]}) can't do that.`);
  return u;
}
