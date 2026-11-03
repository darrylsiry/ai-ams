import { test, expect } from "../guard";

// What anyone on the internet sees, with no login. Tagged @public: runs on production even when no
// uat login is configured. The forms are looked at, never submitted.
test.describe("signed out @public", () => {
  test.use({ extraHTTPHeaders: {} });

  test("liveness endpoint answers", async ({ anon }) => {
    const res = await anon.get("/api/live");
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test("sign-in page shows the form", async ({ page }) => {
    await page.goto("/signin");
    await expect(page.getByRole("heading", { name: "siryous AMS" })).toBeVisible();
    await expect(page.getByLabel("User ID")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("a protected page sends a signed-out visitor to sign in and remembers where they were going", async ({ page }) => {
    await page.goto("/policies");
    await expect(page).toHaveURL(/\/signin\?next=%2Fpolicies/);
  });

  test("the API refuses a caller with no login, with a JSON error and a Basic challenge", async ({ anon }) => {
    const res = await anon.get("/api/health");
    expect(res.status()).toBe(401);
    expect(res.headers()["www-authenticate"]).toMatch(/Basic/);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  test("a wrong Basic password is refused", async ({ anon }) => {
    const res = await anon.get("/api/health", { headers: { Authorization: "Basic " + Buffer.from("uat-nobody:wrong").toString("base64") } });
    expect(res.status()).toBe(401);
  });

  test("the public quote form shows", async ({ page }) => {
    await page.goto("/quote");
    await expect(page.getByRole("heading", { name: "Request a quote" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send request" })).toBeVisible();
  });

  test("the sign-out page only asks", async ({ page }) => {
    await page.goto("/signout");
    await expect(page.getByRole("heading", { name: "Sign out of siryous AMS?" })).toBeVisible();
  });
});
