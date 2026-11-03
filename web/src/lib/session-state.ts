import { db } from "./db";
import { tokenHash } from "./session";

// What the database knows about a login, which a signed cookie can't (SEC-003): whether the person
// was deactivated, and whether this session was ended.

export type LoginState = { active: boolean | null; version: number; revoked: boolean };

/** `active` is null for a login with no profile yet (currentUser creates it on first use). */
export async function loginState(username: string, cookie?: string): Promise<LoginState> {
  const { rows } = await db.query<{ active: boolean | null; version: number | null; revoked: boolean }>(
    `SELECT (SELECT active FROM users WHERE username = $1) AS active,
            (SELECT session_version FROM users WHERE username = $1) AS version,
            EXISTS (SELECT 1 FROM revoked_sessions WHERE token_hash = $2) AS revoked`, [username, cookie ? tokenHash(cookie) : ""]);
  return { active: rows[0].active, version: rows[0].version ?? 0, revoked: rows[0].revoked };
}

/** End this one session; the hash is dropped once the cookie would have expired anyway. */
export async function revokeSession(cookie: string, expiresAt: Date): Promise<void> {
  await db.query("INSERT INTO revoked_sessions (token_hash, expires_at) VALUES ($1,$2) ON CONFLICT DO NOTHING", [tokenHash(cookie), expiresAt]);
  await db.query("DELETE FROM revoked_sessions WHERE expires_at < now()");
}
