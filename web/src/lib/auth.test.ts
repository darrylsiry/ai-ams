import { test } from "node:test";
import assert from "node:assert/strict";
import { authenticate, checkPassword, loadUsers } from "./basic-auth";
import { loginTag, readSession, sessionKey, signSession, verifySession } from "./session";

test("BASIC_AUTH_USERS holds several logins; the single-user form still works", () => {
  const users = loadUsers({ BASIC_AUTH_USERS: "choll:pw1, mrivera:p:w2" });
  assert.equal(users.size, 2);
  assert.equal(checkPassword(users, "choll", "pw1"), true);
  assert.equal(checkPassword(users, "mrivera", "p:w2"), true, "a colon is allowed in a password");
  assert.equal(checkPassword(users, "choll", "nope"), false);
  assert.equal(checkPassword(users, "nobody", "pw1"), false);
  assert.equal(loadUsers({ BASIC_AUTH_PASSWORD: "x" }).get("admin"), "x");
  assert.equal(loadUsers({}).size, 0);
});

test("HTTP Basic resolves to the signed-in name", () => {
  const users = loadUsers({ BASIC_AUTH_USERS: "choll:pw1" });
  const h = (s: string) => `Basic ${Buffer.from(s).toString("base64")}`;
  assert.equal(authenticate(h("choll:pw1"), users), "choll");
  assert.equal(authenticate(h("choll:bad"), users), null);
  assert.equal(authenticate(null, users), null);
});

test("SEC-029: a session names the password it was issued under, without revealing it", () => {
  const key = "fixed-session-secret", exp = new Date(Date.now() + 86_400_000);
  const issued = loginTag("choll", "pw1", key);
  const session = readSession(signSession("choll", key, exp, 0, issued), key)!;
  assert.equal(session.login, issued, "the same password: still good");
  assert.notEqual(session.login, loginTag("choll", "pw2", key), "a changed password: it no longer matches, even with the same secret");
  assert.notEqual(session.login, loginTag("other", "pw1", key));
  assert.equal(readSession(signSession("choll", key, exp), key)!.login, null, "a cookie from before this check has no tag, so it can't match");
  assert.ok(!Buffer.from(signSession("choll", key, exp, 0, issued).split(".")[0], "base64url").toString().includes("pw1"));
});

test("session cookies verify, expire, and resist tampering", () => {
  const key = sessionKey({ BASIC_AUTH_USERS: "choll:pw1" });
  const now = new Date("2026-10-30T12:00:00Z");
  const cookie = signSession("choll", key, new Date("2026-11-06T12:00:00Z"));
  assert.equal(verifySession(cookie, key, now), "choll");
  assert.equal(verifySession(cookie, key, new Date("2026-11-07T00:00:00Z")), null, "expired");
  assert.equal(verifySession(cookie, sessionKey({ BASIC_AUTH_USERS: "choll:changed" }), now), null, "changing passwords signs everyone out");
  const forged = `${Buffer.from(JSON.stringify({ u: "admin", exp: Date.parse("2026-11-06T12:00:00Z") })).toString("base64url")}.${cookie.split(".")[1]}`;
  assert.equal(verifySession(forged, key, now), null, "a payload naming someone else fails the signature");
  assert.equal(verifySession(undefined, key, now), null);
});
