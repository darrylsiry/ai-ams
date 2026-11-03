import { test, expect, expectFlash, field, idFrom, sql, val, saveState, need, T } from "./fixtures";

// The sales pipeline as a producer: opportunity, stages, markets, quote, won into a policy; and the
// public quote form creating a lead.
test("new opportunity on a new prospect, with its first task", async ({ as }) => {
  const page = await as("rcallahan");
  const prospect = `UAT Prospect ${T} Inc`;
  await page.goto("/sales");
  await page.getByRole("link", { name: "＋ Opportunity" }).click();
  await page.getByRole("link", { name: "New prospect first" }).click();
  await expect(page.getByRole("heading", { name: "New client or prospect" })).toBeVisible();
  await field(page, "name").fill(prospect);
  await field(page, "account_manager_id").selectOption({ label: "Marisol Rivera" });
  await field(page, "contact_first").fill("Sam");
  await field(page, "contact_last").fill("Prospect");
  await page.getByRole("button", { name: "Create client" }).click();
  // Straight on to the opportunity, with the new prospect already chosen.
  await expectFlash(page, "Prospect created. Now describe the opportunity.");
  await expect(page).toHaveURL(/\/sales\/new\?client=\d+/);
  const client = new URL(page.url()).searchParams.get("client")!;
  saveState({ saleClient: client, saleProspect: prospect });
  await expect(page.getByRole("combobox", { name: "Client" })).toHaveValue(prospect);
  await field(page, "name").fill(`Commercial package ${T}`);
  await field(page, "kind").selectOption("new");
  await page.getByRole("checkbox", { name: "General Liability" }).check();
  await field(page, "est_premium").fill("15000");
  await field(page, "source").fill("Referral");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectFlash(page, "Opportunity created");
  const opp = idFrom(page.url(), "sales");
  saveState({ opp });
  await expect(page.getByRole("heading", { name: `Commercial package ${T}` })).toBeVisible();
  await expect(page.getByText("lead", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: `Gather exposures and submit: Commercial package ${T}` })).toBeVisible();
  await page.goto("/sales");
  const lead = page.locator("div.rounded-lg").filter({ hasText: /^Lead/ });
  await expect(lead.locator(`a[href="/sales/${opp}"]`)).toBeVisible();
});

test("stage changes move it across the board", async ({ as }) => {
  const opp = need("opp");
  const page = await as("rcallahan");
  await page.goto(`/sales/${opp}`);
  await field(page, "stage").selectOption("qualifying");
  await page.getByRole("button", { name: "Update" }).click();
  await expectFlash(page, "Stage updated");
  await expect(page.getByText("qualifying", { exact: true }).first()).toBeVisible();
  await page.goto("/sales");
  await expect(page.locator("div.rounded-lg").filter({ hasText: /^Qualifying/ }).locator(`a[href="/sales/${opp}"]`)).toBeVisible();
});

test("submit to markets, record a declination and a quote; the stage follows", async ({ as }) => {
  const opp = need("opp");
  const page = await as("rcallahan");
  await page.goto(`/sales/${opp}`);
  await expect(page.getByText("No submissions yet.")).toBeVisible();
  const options = page.locator('input[name="carrier_ids"]');
  expect(await options.count()).toBeGreaterThan(1);
  const carriers = (await page.locator('label:has(input[name="carrier_ids"])').allInnerTexts()).map((t) => t.trim());
  expect(carriers).toContain("Piedmont Fire & Casualty");
  const other = carriers.find((c) => c !== "Piedmont Fire & Casualty")!;
  await page.getByRole("checkbox", { name: "Piedmont Fire & Casualty" }).check();
  await page.getByRole("checkbox", { name: other! }).check();
  await page.getByRole("button", { name: "Add selected" }).click();
  await expectFlash(page, "2 market(s) added");
  await expect(page.getByRole("heading", { name: "Markets · 2" })).toBeVisible();
  await expect(page.getByText("submitted", { exact: true }).first()).toBeVisible();

  const otherRow = page.getByRole("row").filter({ hasText: other! });
  await otherRow.getByText("Update", { exact: true }).click();
  await otherRow.locator('select[name="status"]').selectOption("declined");
  await otherRow.locator('input[name="declination_reason"]').fill("Class not written");
  await otherRow.getByRole("button", { name: "Save" }).click();
  await expectFlash(page, "Submission updated");
  await expect(page.getByRole("row").filter({ hasText: other! }).getByText("Class not written")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: other! }).getByRole("link", { name: "Bind →" }), "nothing to bind on a declination").toHaveCount(0);

  const pfc = page.getByRole("row").filter({ hasText: "Piedmont Fire & Casualty" });
  await pfc.getByText("Update", { exact: true }).click();
  await pfc.locator('select[name="status"]').selectOption("quoted");
  await pfc.locator('input[name="quoted_premium"]').fill("14250");
  await pfc.getByRole("button", { name: "Save" }).click();
  await expectFlash(page, "Submission updated");
  await expect(page.getByRole("row").filter({ hasText: "Piedmont Fire & Casualty" }).getByText("$14,250")).toBeVisible();
  await expect(page.locator("main").getByText("quoted", { exact: true }).first()).toBeVisible();
  await page.goto("/sales");
  await expect(page.locator("div.rounded-lg").filter({ hasText: /^Quoted/ }).locator(`a[href="/sales/${opp}"]`)).toBeVisible();
});

test("won: binding the quote makes the policy, wins the opportunity, and the prospect becomes an insured", async ({ as }) => {
  const opp = need("opp"), client = need("saleClient");
  const page = await as("rcallahan");
  await page.goto(`/sales/${opp}`);
  await page.getByRole("link", { name: "Bind →" }).click();
  await expect(page).toHaveURL(new RegExp(`/policies/new\\?client=${client}&opportunity=${opp}`));
  await expect(field(page, "carrier_id").locator("option:checked")).toHaveText("Piedmont Fire & Casualty");
  await expect(field(page, "premium")).toHaveValue("14250.00");
  await field(page, "lob").selectOption("GL");
  await field(page, "policy_number").fill(`UATWON-${T}-01`);
  await field(page, "status").selectOption("bound");
  await page.getByRole("button", { name: "Create policy" }).click();
  await expectFlash(page, "Policy created.");
  await expect(page.getByRole("heading", { name: `UATWON-${T}-01` })).toBeVisible();

  await page.goto(`/sales/${opp}`);
  await expect(page.getByText("won", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Bound policy" }).click();
  await expect(page.getByRole("heading", { name: `UATWON-${T}-01` })).toBeVisible();
  await page.goto(`/clients/${client}`);
  await expect(page.locator("h1").getByText("insured")).toBeVisible();
  await page.goto("/sales");
  await expect(page.locator(`a[href="/sales/${opp}"]`), "won work leaves the board").toHaveCount(0);
});

test("a lost opportunity records why and cancels its work", async ({ as }) => {
  const client = need("saleClient");
  const page = await as("rcallahan");
  await page.goto(`/sales/new?client=${client}`);
  await field(page, "name").fill(`Cross-sell umbrella ${T}`);
  await field(page, "kind").selectOption("cross_sell");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expectFlash(page, "Opportunity created");
  const opp = idFrom(page.url(), "sales");
  await field(page, "stage").selectOption("lost");
  await field(page, "lost_reason").fill("Price");
  await page.getByRole("button", { name: "Update" }).click();
  await expectFlash(page, "Stage updated");
  await expect(page.getByText("Lost reason")).toBeVisible();
  await expect(page.getByText("Price", { exact: true })).toBeVisible();
  expect(val(`select count(*) from activities where opportunity_id = ${opp} and status in ('open','waiting')`)).toBe("0");
});

test("an opportunity needs a client and a name", async ({ as }) => {
  const page = await as("rcallahan");
  await page.goto("/sales/new");
  await field(page, "name").fill("No client chosen");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  // The browser's required check stops it before it leaves the page.
  await expect(page).toHaveURL(/\/sales\/new/);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test.describe("the public quote form", () => {
  test("a visitor fills it in and is thanked", async ({ signedOut }) => {
    const page = await signedOut();
    const email = `lead-${T}@visitor.example`;
    // Browser routing can't stop a redirect, so the form post is relayed here: if the app sends the
    // visitor off this site, the page says so rather than loading whatever else runs on that address.
    await page.route("**/api/leads", async (route) => {
      const res = await route.fetch({ maxRedirects: 0 });
      const to = new URL(res.headers()["location"] ?? "/", route.request().url());
      if (to.origin === new URL(route.request().url()).origin) return route.fulfill({ response: res });
      return route.fulfill({ status: 200, contentType: "text/plain", body: `The app redirected the visitor off this site, to ${to.href}` });
    });
    await page.goto("/quote");
    await expect(page.getByRole("heading", { name: "Request a quote" })).toBeVisible();
    await field(page, "first_name").fill("Vera");
    await field(page, "last_name").fill("Visitor");
    await field(page, "business").fill(`Visitor Plumbing ${T}`);
    await field(page, "email").fill(email);
    await field(page, "phone").fill("(919) 555-1000");
    await field(page, "zip").fill("27601");
    await page.getByRole("checkbox", { name: "Business insurance" }).check();
    await field(page, "message").fill("We have 3 vans");
    await page.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Thank you — we received your request")).toBeVisible({ timeout: 15_000 });
  });

  test("the lead arrives: a prospect, a contact, and a normal-priority task for a producer", async ({ as }) => {
    // Depends only on the form having reached the server, so it reports separately from the thank-you.
    const rows = sql(`select id, status, source, email from clients where name = 'Visitor Plumbing ${T}'`);
    expect(rows.length, "the prospect exists").toBe(1);
    const [id, status, source] = rows[0];
    expect(status).toBe("prospect");
    expect(source).toBe("Website quote form");
    const page = await as("choll");
    await page.goto(`/clients/${id}?tab=contacts`);
    await expect(page.getByRole("cell", { name: "Vera Visitor" })).toBeVisible();
    await page.goto(`/tasks?view=team&q=${encodeURIComponent(`Website quote request: Visitor Plumbing ${T}`)}`);
    const row = page.getByRole("row").filter({ hasText: `Website quote request: Visitor Plumbing ${T}` });
    await expect(row.getByText("Normal"), "an anonymous form can't create high-priority work").toBeVisible();
    await expect(row.getByRole("cell", { name: /Callahan|Whitaker|Foster/ })).toBeVisible();
    await row.getByRole("link", { name: /Website quote request/ }).click();
    await expect(page.getByText(/Interested in: Business insurance/)).toBeVisible();
  });

  test("the API answers a browser post with a redirect back to this site, and refuses incomplete requests", async ({ anon, baseURL }) => {
    const res = await anon.post("/api/leads", { form: { first_name: "Only", last_name: "Name" }, maxRedirects: 0 });
    expect(res.status()).toBe(303);
    const target = new URL(res.headers()["location"], baseURL);
    expect(target.pathname + target.search).toBe("/quote?error=1");
    expect(target.host, "the redirect stays on the address the visitor used").toBe(new URL(baseURL!).host);
  });

  test("the honeypot field quietly drops a bot's post", async ({ anon }) => {
    const before = val("select count(*) from clients");
    const res = await anon.post("/api/leads", { form: { first_name: "Bot", last_name: "Bot", email: "bot@spam.example", website_url: "http://spam.example" }, maxRedirects: 0 });
    expect(res.status()).toBe(303);
    expect(val("select count(*) from clients")).toBe(before);
  });
});
