import { test, expect, sql, val, LOGINS, FULL_NAME, basic } from "./fixtures";
import fs from "node:fs";

// Signing in and out through the real pages (fresh browser, no saved session).
test.beforeAll(() => {
  fs.mkdirSync(".work", { recursive: true });
  for (const f of fs.readdirSync(".work")) if (/^auth-.*\.json$|^sandbox-state\.json$/.test(f)) fs.rmSync(`.work/${f}`);
});

test("a wrong password is refused with a message and keeps the user ID", async ({ signedOut }) => {
  const page = await signedOut();
  await page.goto("/signin");
  await page.getByLabel("User ID").fill("mrivera");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That user ID or password isn't right.")).toBeVisible();
  await expect(page.getByLabel("User ID")).toHaveValue("mrivera");
});

test("a signed-out browser is sent to sign in, and signing in returns to the page it asked for", async ({ signedOut }) => {
  const page = await signedOut();
  await page.goto("/policies");
  await expect(page).toHaveURL(/\/signin\?next=%2Fpolicies/);
  await page.getByLabel("User ID").fill("mrivera");
  await page.getByLabel("Password").fill(LOGINS.mrivera);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/policies$/);
  await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
  await expect(page.locator("header").getByText(FULL_NAME.mrivera!)).toBeVisible();
});

test("signing in can't be used to bounce someone to another site", async ({ signedOut }) => {
  const page = await signedOut();
  await page.goto("/signin?next=//evil.example/phish");
  await page.getByLabel("User ID").fill("mrivera");
  await page.getByLabel("Password").fill(LOGINS.mrivera);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Start next task" })).toBeVisible();
  expect(new URL(page.url()).host).toBe(new URL(process.env.UAT_BASE_URL ?? "http://127.0.0.1:3950").host);
});

test("sign out from the header menu ends the session; GET /signout only asks", async ({ signedOut }) => {
  const page = await signedOut();
  await page.goto("/signin");
  await page.getByLabel("User ID").fill("kowens");
  await page.getByLabel("Password").fill(LOGINS.kowens);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "Start next task" })).toBeVisible();
  await page.goto("/signout");
  await expect(page.getByRole("heading", { name: "Sign out of siryous AMS?" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start next task" }), "the GET changed nothing").toBeVisible();
  await page.locator("header").getByRole("button", { name: /Kayla Owens/ }).click();
  await expect(page.getByText("Customer service rep")).toBeVisible();
  await expect(page.getByText(`kowens@inbox.siryous.local`)).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/signin\?signedout=1/);
  await expect(page.getByText("You're signed out.")).toBeVisible();
  await page.goto("/policies");
  await expect(page).toHaveURL(/\/signin/);
});

test("the 'Working as' menu is gone when sign-in is on", async ({ as }) => {
  const page = await as("mrivera");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Start next task" })).toBeVisible();
  await expect(page.getByText("Working as")).toHaveCount(0);
  await expect(page.locator("#working-as")).toHaveCount(0);
});

test("API calls with no login get a 401, a JSON error and a Basic challenge", async ({ anon }) => {
  const res = await anon.get("/api/health");
  expect(res.status()).toBe(401);
  expect(res.headers()["www-authenticate"]).toMatch(/Basic/);
  expect((await res.json()).error.code).toBe("unauthorized");
  const wrong = await anon.get("/api/health", { headers: { Authorization: "Basic " + Buffer.from("mrivera:wrong").toString("base64") } });
  expect(wrong.status()).toBe(401);
  const right = await anon.get("/api/health", { headers: { Authorization: basic("mrivera") } });
  expect(right.status()).toBe(200);
  // A page asked for by something that isn't a browser gets the 401, not a redirect to the form.
  const page = await anon.get("/clients", { headers: { Accept: "application/json" }, maxRedirects: 0 });
  expect(page.status()).toBe(401);
});

test("the signed-in-user header can't be forged from outside", async ({ anon }) => {
  const asCsr = await anon.get("/admin/users/new", { headers: { Authorization: basic("kowens"), "x-ams-signed-in-user": "admin", Accept: "text/html" } });
  expect(await asCsr.text()).toContain("You can&#x27;t open");
  const noLogin = await anon.get("/api/health", { headers: { "x-ams-signed-in-user": "admin" } });
  expect(noLogin.status()).toBe(401);
});

test("a login with no profile yet gets a customer-service profile on first sign-in", async ({ as }) => {
  expect(val("select count(*) from users where username = 'autoprov'")).toBe("0");
  const page = await as("autoprov");
  await page.goto("/");
  await page.locator("header").getByRole("button", { name: /autoprov/ }).click();
  await expect(page.getByText("Customer service rep")).toBeVisible();
  expect(sql("select role, active from users where username = 'autoprov'")).toEqual([["csr", "t"]]);
});

test("sign-ins, failures included, show on Reports > Users", async ({ as }) => {
  const page = await as("admin");
  await page.goto("/reports/users?user=mrivera");
  await expect(page.getByRole("heading", { name: /Sign-ins & actions · Marisol Rivera/ })).toBeVisible();
  const events = page.locator("section").filter({ hasText: "Sign-in events" });
  await expect(events.getByText("failed").first()).toBeVisible();
  await expect(events.getByText("ok").first()).toBeVisible();
});
