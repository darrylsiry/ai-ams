import { test, expect, field, val, T } from "./fixtures";

// Asking for a login from the signed-out sign-in page. The sandbox has no SMTP_URL, so every request is
// kept and listed as not emailed: that is the path real mail takes when it fails, too.

test.describe("request access", () => {
  const who = `UAT Requester ${T}`;   // fixed for the run, so a retried test still finds the first one's request

  test("the sign-in page offers it; a request keeps what was typed when it's wrong, then thanks the person", async ({ signedOut }) => {
    const page = await signedOut();
    await page.goto("/signin");
    await page.getByRole("link", { name: "Request access" }).click();
    await expect(page).toHaveURL(/\/request-access$/);
    await expect(page.getByRole("heading", { name: "Request access" })).toBeVisible();
    await field(page, "name").fill(who);
    await field(page, "email").fill("not an address");
    await field(page, "company").fill("UAT Agency");
    await page.locator("form").evaluate((f: HTMLFormElement) => f.setAttribute("novalidate", ""));
    await page.getByRole("button", { name: "Request access" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
    await expect(field(page, "name")).toHaveValue(who);
    await expect(field(page, "company")).toHaveValue("UAT Agency");
    expect(page.url(), "nothing typed goes into the address").not.toContain("UAT");
    await field(page, "email").fill("uat.requester@agency.example.com");
    await page.getByRole("button", { name: "Request access" }).click();
    await expect(page.getByRole("status").getByText("Request sent")).toBeVisible();
    await expect(page.getByText("uat.requester@agency.example.com")).toBeVisible();
    expect(val(`select count(*) from access_requests where name = '${who}' and company = 'UAT Agency' and emailed_at is null and email_error like '%SMTP_URL%'`)).toBe("1");
    await page.getByRole("link", { name: "← Back to sign in" }).click();
    await expect(page).toHaveURL(/\/signin/);
  });

  test("a bot filling the hidden field is thanked, and nothing is kept", async ({ signedOut }) => {
    const page = await signedOut();
    await page.goto("/request-access");
    await field(page, "name").fill(`${who} bot`);
    await field(page, "email").fill("bot@agency.example.com");
    await page.locator('input[name="website"]').evaluate((i: HTMLInputElement) => { i.value = "https://spam.example"; });
    await page.getByRole("button", { name: "Request access" }).click();
    await expect(page.getByText("Request sent")).toBeVisible();
    expect(val(`select count(*) from access_requests where name = '${who} bot'`)).toBe("0");
  });

  test("a flood from one network is refused after three an hour", async ({ signedOut }) => {
    const page = await signedOut();
    const before = Number(val("select count(*) from access_requests where created_at > now() - interval '1 hour'"));
    for (let i = before; i < 4; i++) {
      await page.goto("/request-access");
      await field(page, "name").fill(`${who} ${i}`);
      await field(page, "email").fill(`flood${i}@agency.example.com`);
      await page.getByRole("button", { name: "Request access" }).click();
      if (i < 3) await expect(page.getByText("Request sent")).toBeVisible();
      else await expect(page.getByText(/several requests from your network/)).toBeVisible();
    }
    expect(Number(val("select count(*) from access_requests where created_at > now() - interval '1 hour'"))).toBe(3);
  });

  test("an administrator sees each request and whether it was emailed; nobody else does", async ({ as }) => {
    const admin = await as("admin");
    await admin.goto("/reports/users");
    const row = admin.getByRole("row").filter({ hasText: "uat.requester@agency.example.com" }).first();
    await expect(row).toContainText(who);
    await expect(row).toContainText("not sent");
    await expect(row.getByRole("link", { name: "uat.requester@agency.example.com" })).toHaveAttribute("href", "mailto:uat.requester@agency.example.com");
    const principal = await as("choll");
    await principal.goto("/reports/users");
    await expect(principal.getByText("You can't open the users and sign-ins report")).toBeVisible();
  });
});
