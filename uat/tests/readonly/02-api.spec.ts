import { test, expect, USER } from "../guard";

test("health reports the database up, behind the sign-in", async ({ api }) => {
  const res = await api.get("/api/health");
  expect(res.status()).toBe(200);
  const j = await res.json();
  expect(j.ok).toBe(true);
  expect(j.database).toBe("up");
  expect(j.clients).toBeGreaterThan(0);
  expect(USER).toBeTruthy();
});

test("the inbound email webhook describes itself on a GET", async ({ api }) => {
  const res = await api.get("/api/inbound/email");
  expect(res.status()).toBe(200);
  expect(JSON.stringify(await res.json())).toContain("INBOUND_EMAIL_TOKEN");
});
