// The browser's sign-in: a signed, expiring cookie naming the user, issued by the sign-in page and
// checked by middleware.ts on every request (API clients keep using HTTP Basic). Pure module
// (node:crypto only) for node:test.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "ams_session";
export const SESSION_DAYS = 7;

/**
 * The signing key: SESSION_SECRET when set, else derived from the configured logins, so a
 * deployment needs no extra secret and changing the passwords signs everyone out.
 */
export function sessionKey(env: Record<string, string | undefined>): string {
  return env.SESSION_SECRET || createHash("sha256").update(`siryous-ams-session:${env.BASIC_AUTH_USERS ?? ""}:${env.BASIC_AUTH_PASSWORD ?? ""}`).digest("hex");
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const mac = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");

export type Session = { name: string; version: number; expiresAt: Date; login: string | null };

/** What ties a session to the password it was issued under, so changing that password ends it (SEC-029). Keyed, so the cookie reveals nothing about the password. */
export const loginTag = (name: string, password: string, key: string) => mac(`login:${name}:${password}`, key).slice(0, 22);

/** A cookie value for `name`, valid until `expiresAt`. `version` is the user's session_version (SEC-003). `login` is its loginTag. */
export function signSession(name: string, key: string, expiresAt: Date, version = 0, login?: string): string {
  const payload = b64(JSON.stringify({ u: name, exp: expiresAt.getTime(), v: version, l: login }));
  return `${payload}.${mac(payload, key)}`;
}

/** What a cookie value, or a stored revocation, is known by: never the cookie itself. */
export const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

/** The user a cookie value names, or null when it is missing, tampered with or expired. */
export function verifySession(value: string | undefined | null, key: string, now = new Date()): string | null {
  return readSession(value, key, now)?.name ?? null;
}

/** The session a cookie value holds, or null when it is missing, tampered with or expired. */
export function readSession(value: string | undefined | null, key: string, now = new Date()): Session | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = value.slice(0, dot), sig = value.slice(dot + 1);
  const expected = mac(payload, key);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { u, exp, v, l } = JSON.parse(unb64(payload)) as { u?: unknown; exp?: unknown; v?: unknown; l?: unknown };
    if (typeof u !== "string" || !u || typeof exp !== "number" || exp <= now.getTime()) return null;
    return { name: u, version: typeof v === "number" ? v : 0, expiresAt: new Date(exp), login: typeof l === "string" ? l : null };
  } catch {
    return null;
  }
}
