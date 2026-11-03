import { test, expect, type Blocked } from "../guard";
import type { Page } from "@playwright/test";

/**
 * Dry runs: click the real write buttons, as a user would, and prove two things: the button is wired
 * to send a server action (a POST with a next-action header, which the guard catches), and nothing
 * reached the server (the record isn't there afterwards). On production this is how write functions
 * are checked without writing; their full effect is tested in the sandbox suite.
 */
async function caught(blocked: Blocked[], before: number, what: string) {
  await expect.poll(() => blocked.slice(before).length, { timeout: 15_000, message: `${what}: a write was sent and stopped` }).toBeGreaterThan(0);
  expect(blocked[before].method).toBe("POST");
}
async function settled(page: Page) { await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {}); }

test.describe("write buttons are wired, and the guard stops them", () => {
  test("complete a task", async ({ page, blocked }) => {
    await page.goto("/tasks?view=team");
    await settled(page);
    const links = page.locator("main table a[href^='/tasks/']");
    const hrefs = [...new Set(await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")!)))];
    test.skip(!hrefs.length, "no open task to try");
    // A login without team rights can only finish its own or unassigned tasks, and others show no Done button.
    let href: string | null = null;
    for (const h of hrefs.slice(0, 10)) {
      await page.goto(h);
      await expect(page.getByRole("heading", { name: "Finish this task" })).toBeVisible();
      if (await page.getByRole("button", { name: "Done", exact: true }).count()) { href = h; break; }
    }
    test.skip(!href, "no open task this login may finish");
    const n = blocked.length;
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await caught(blocked, n, "Done");
    expect(blocked[n].action, "sent as a server action").toBeTruthy();
    await page.goto(href!);
    await expect(page.getByRole("button", { name: "Done", exact: true }), "the task is still open").toBeVisible();
  });

  test("issue a certificate", async ({ page, blocked }) => {
    await page.goto("/certificates");
    const client = page.locator("main table a[href^='/clients/']").first();
    test.skip(!(await client.count()), "no certificate to find an insured from");
    const id = (await client.getAttribute("href"))!.split("/").pop();
    await page.goto(`/certificates/new?client=${id}`);
    await settled(page);
    await page.getByRole("radio", { name: /New holder/ }).check();
    await page.locator('[name="holder_name"]').fill("UAT dry run holder");
    const n = blocked.length;
    await page.getByRole("button", { name: "Issue certificate" }).click();
    await caught(blocked, n, "Issue certificate");
    expect(blocked[n].action, "sent as a server action").toBeTruthy();
    await page.goto("/certificates?status=all&q=UAT+dry+run+holder");
    await expect(page.getByText("No certificates.")).toBeVisible();
  });

  test("post a receipt", async ({ page, blocked }) => {
    await page.goto("/accounting/receipts/new");
    test.skip(await page.getByText(/You can't open|Accounting is available to/).first().isVisible(), "this login can't post receipts");
    // Find a client the way a user does: search, take the first match, load their invoices.
    await page.getByRole("combobox", { name: "Client" }).fill("an");
    const match = page.getByRole("option").first();
    await match.waitFor({ timeout: 5_000 }).catch(() => {});
    test.skip(!(await match.count()), "no client with an open balance");
    await match.click();
    await page.getByRole("button", { name: "Load invoices" }).click();
    await expect(page).toHaveURL(/client=\d+/);
    await settled(page);
    await page.locator('[name="amount"]').fill("1.00");
    await page.locator('[name="reference"]').fill("UAT-DRY-RUN");
    const n = blocked.length;
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Post receipt" }).click();
    await caught(blocked, n, "Post receipt");
    expect(blocked[n].action, "sent as a server action").toBeTruthy();
    await page.goto("/accounting/receipts");
    await expect(page.getByText("UAT-DRY-RUN")).toHaveCount(0);
  });

  test("save a new client", async ({ page, blocked }) => {
    await page.goto("/clients/new");
    await settled(page);
    await page.locator('[name="name"]').fill("UAT Dry Run Client");
    const n = blocked.length;
    await page.getByRole("button", { name: "Create client" }).click();
    await caught(blocked, n, "Create client");
    expect(blocked[n].action, "sent as a server action").toBeTruthy();
    await page.goto("/clients?status=all&q=UAT+Dry+Run+Client");
    await expect(page.getByText("No clients match.")).toBeVisible();
  });

  test("create a task", async ({ page, blocked }) => {
    await page.goto("/tasks/new");
    await settled(page);
    await page.locator('[name="subject"]').fill("UAT dry run task");
    const n = blocked.length;
    await page.getByRole("button", { name: "Create task" }).click();
    await caught(blocked, n, "Create task");
    expect(blocked[n].action, "sent as a server action").toBeTruthy();
    await page.goto("/tasks?view=team&status=all&q=UAT+dry+run+task");
    await expect(page.getByRole("link", { name: "UAT dry run task" })).toHaveCount(0);
  });

  test("sign out from the header (the session is untouched)", async ({ page, blocked }) => {
    await page.goto("/");
    await settled(page);
    await page.locator("header [aria-haspopup='menu']").last().click();
    const n = blocked.length;
    await page.getByRole("button", { name: "Sign out" }).click();
    await caught(blocked, n, "Sign out");
    expect(blocked[n].url).toMatch(/\/signout$/);
    await page.waitForTimeout(300);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Start next task" })).toBeVisible();
  });
});

test("the API clients have no way to send anything but a GET", async ({ request }) => {
  const write = "post" as const;
  expect(() => request[write]("/api/live")).toThrow(/read-only/);
});
