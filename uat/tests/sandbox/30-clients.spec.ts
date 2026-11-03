import { pickClient, test, expect, expectFlash, expectError, field, idFrom, sql, val, saveState, need, T, FULL_NAME } from "./fixtures";

// Clients: as an account manager. The prospects made here are the ones the policy flows write on.

test("create a business prospect with a primary contact and a lead task", async ({ as }) => {
  const page = await as("mrivera");
  const name = `UAT Contracting ${T} LLC`;
  await page.goto("/clients");
  await page.getByRole("link", { name: "＋ New client" }).click();
  await expect(page.getByRole("heading", { name: "New client or prospect" })).toBeVisible();
  await field(page, "name").fill(name);
  await field(page, "kind").selectOption("business");
  await field(page, "industry").fill("Construction");
  await field(page, "email").fill(`office-${T}@uatcontracting.example`);
  await field(page, "phone").fill("(919) 555-7" + String(Date.now()).slice(-3));
  await field(page, "address1").fill("100 Test St");
  await field(page, "city").fill("Raleigh");
  await field(page, "zip").fill("27601");
  await field(page, "contact_first").fill("Dana");
  await field(page, "contact_last").fill("Tester");
  await field(page, "contact_email").fill(`dana-${T}@uatcontracting.example`);
  await field(page, "account_manager_id").selectOption({ label: FULL_NAME.mrivera! });
  await field(page, "producer_id").selectOption({ label: FULL_NAME.rcallahan! });
  await page.getByRole("button", { name: "Create client" }).click();
  await expectFlash(page, "Client created");
  const id = idFrom(page.url(), "clients");
  saveState({ bizClient: id, bizName: name, bizPhone: await page.locator("dd").filter({ hasText: "(919) 555-7" }).first().innerText() });
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.locator("h1").getByText("prospect")).toBeVisible();
  await expect(page.getByText("100 Test St")).toBeVisible();
  await page.goto(`/clients/${id}?tab=contacts`);
  await expect(page.getByRole("cell", { name: "Dana Tester" })).toBeVisible();
  await expect(page.getByText("primary", { exact: true })).toBeVisible();
  await page.goto(`/clients/${id}?tab=activity`);
  await expect(page.getByRole("link", { name: `New prospect: ${name}` })).toBeVisible();
  await page.goto("/clients?status=prospect");
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("create a personal client", async ({ as }) => {
  const page = await as("mrivera");
  const name = `Uat Householder ${T}`;
  await page.goto("/clients/new?kind=individual");
  await field(page, "name").fill(name);
  await expect(field(page, "kind")).toHaveValue("individual");
  await field(page, "household").fill("Householder family");
  await field(page, "city").fill("Cary");
  await field(page, "account_manager_id").selectOption({ label: FULL_NAME.mrivera! });
  await field(page, "contact_first").fill("Uat");
  await field(page, "contact_last").fill("Householder");
  await field(page, "contact_email").fill(`uat-${T}@home.example`);
  await page.getByRole("button", { name: "Create client" }).click();
  await expectFlash(page, "Client created");
  const id = idFrom(page.url(), "clients");
  saveState({ personalClient: id, personalName: name });
  await expect(page.getByText("Personal lines").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Issue certificate" }), "certificates are for businesses").toHaveCount(0);
});

test("the duplicate check catches a repeat name, email or phone, and 'create anyway' overrides it", async ({ as }) => {
  const name = need("bizName");
  const page = await as("mrivera");
  await page.goto("/clients/new");
  await field(page, "name").fill(name);
  await page.getByRole("button", { name: "Create client" }).click();
  await expectError(page, new RegExp(`Possible duplicate of ${name}`));
  await expect(page).toHaveURL(/\/clients\/new/);
  expect(val(`select count(*) from clients where name = '${name}'`)).toBe("1");

  const phone = need("bizPhone");
  await page.goto("/clients/new");
  await field(page, "name").fill(`UAT Other Name ${T}`);
  await field(page, "phone").fill(phone);
  await page.getByRole("button", { name: "Create client" }).click();
  await expectError(page, new RegExp(`Possible duplicate of ${name}`));

  await page.goto("/clients/new");
  await field(page, "name").fill(name);
  await field(page, "confirm_duplicate").check();
  await page.getByRole("button", { name: "Create client" }).click();
  await expectFlash(page, "Client created");
  expect(val(`select count(*) from clients where name = '${name}'`)).toBe("2");
  saveState({ dupClient: idFrom(page.url(), "clients") });
});

test("edit a client", async ({ as }) => {
  const id = need("bizClient");
  const page = await as("mrivera");
  await page.goto(`/clients/${id}`);
  await page.getByRole("link", { name: "Edit" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/clients/${id}/edit`));
  await field(page, "website").fill("www.uatcontracting.example");
  await field(page, "employees").fill("42");
  await field(page, "tags").fill("uat, builders");
  await field(page, "do_not_call").check();
  await field(page, "sms_consent").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expectFlash(page, "Saved");
  await expect(page.getByText("www.uatcontracting.example")).toBeVisible();
  await expect(page.getByText("Do not call").first()).toBeVisible();
  await expect(page.getByText("SMS consent")).toBeVisible();
  await expect(page.getByText("builders").first()).toBeVisible();
  // What was there stays there.
  await expect(page.getByText("100 Test St")).toBeVisible();
  await expect(page.getByText("Ryan Callahan").first()).toBeVisible();
});

test("contacts: add, edit, make primary, remove", async ({ as }) => {
  const id = need("bizClient");
  const page = await as("mrivera");
  await page.goto(`/clients/${id}?tab=contacts`);
  await field(page, "first_name").fill("Chris");
  await field(page, "last_name").fill("Second");
  await field(page, "title").fill("Bookkeeper");
  await field(page, "email").fill(`chris-${T}@uatcontracting.example`);
  await field(page, "is_billing").check();
  await page.getByRole("button", { name: "Save contact" }).click();
  await expectFlash(page, "Contact saved");
  const row = page.getByRole("row").filter({ hasText: "Chris Second" });
  await expect(row.getByText("Bookkeeper")).toBeVisible();
  await expect(row.getByText("billing")).toBeVisible();

  await row.getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit Chris Second" })).toBeVisible();
  await field(page, "title").fill("Controller");
  await field(page, "is_primary").check();
  await page.getByRole("button", { name: "Save contact" }).click();
  await expectFlash(page, "Contact saved");
  await expect(page.getByRole("row").filter({ hasText: "Chris Second" }).getByText("Controller")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Chris Second" }).getByText("primary"), "the new primary").toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Dana Tester" }).getByText("primary"), "only one primary").toHaveCount(0);

  await page.getByRole("row").filter({ hasText: "Chris Second" }).getByRole("button", { name: "Remove" }).click();
  await expectFlash(page, "Contact removed");
  await expect(page.getByRole("row").filter({ hasText: "Chris Second" })).toHaveCount(0);
});

test("every client tab opens, with its counts", async ({ as }) => {
  const id = val(`select c.id from clients c where c.status = 'insured' and c.kind = 'business' and exists (select 1 from claims cl where cl.client_id = c.id) and exists (select 1 from certificates ce where ce.client_id = c.id) and exists (select 1 from invoices i where i.client_id = c.id) order by c.id limit 1`);
  const page = await as("choll");
  await page.goto(`/clients/${id}`);
  await expect(page.getByRole("heading", { name: "In-force policies" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open work" })).toBeVisible();
  for (const [link, expected] of [["Policies", "terms stay on file"], ["Activity", "Notes and calls"], ["Contacts", "Add contact"], ["Schedules", "Add to schedule"], ["Certificates", /Certificates · \d+/], ["Claims", /Claims · \d+/], ["Billing", "Agency-bill invoices"], ["Documents", "Upload document"], ["Email", /Email · \d+/]] as const) {
    await page.locator("main nav").getByRole("link", { name: new RegExp(`^${link}`) }).click();
    await expect(page).toHaveURL(new RegExp(`tab=${link === "Email" ? "emails" : link.toLowerCase()}`));
    await expect(page.locator("main").getByText(expected as string).first(), `${link} tab`).toBeVisible();
  }
});

test("schedules: add an item and remove it", async ({ as }) => {
  const id = need("bizClient");
  const page = await as("mrivera");
  await page.goto(`/clients/${id}?tab=schedules`);
  await field(page, "kind").selectOption("vehicle");
  await field(page, "label").fill("2026 Ford F-250");
  await field(page, "d_identifier").fill("1FTBF2B60TEA00001");
  await field(page, "d_year").fill("2026");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectFlash(page, "Added to schedule");
  await expect(page.getByText("2026 Ford F-250", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vehicles · 1" })).toBeVisible();
  await field(page, "label").fill("100 Test St yard");
  await field(page, "kind").selectOption("location");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectFlash(page, "Added to schedule");
  await page.locator("li").filter({ hasText: "100 Test St yard" }).getByRole("button", { name: "Remove" }).click();
  await expectFlash(page, "Removed from schedule");
  await expect(page.getByText("100 Test St yard")).toHaveCount(0);
});

test("upload a document and download the same bytes; a restricted one needs PII access", async ({ as }) => {
  const id = need("bizClient");
  const page = await as("mrivera");
  const bytes = Buffer.from(`UAT application ${T}\n`);
  await page.goto(`/clients/${id}?tab=documents`);
  await page.getByRole("button", { name: "Upload", exact: true }).click();   // the browser's own "required" stops an empty form
  await expect(page).toHaveURL(/tab=documents$/);
  await field(page, "file").setInputFiles({ name: "application.txt", mimeType: "text/plain", buffer: bytes });
  await field(page, "title").fill("Signed application");
  await field(page, "folder").selectOption("Applications");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expectFlash(page, "Uploaded");
  const link = page.getByRole("link", { name: "Signed application" });
  await expect(link).toBeVisible();
  await expect(page.getByRole("heading", { name: "Applications · 1" })).toBeVisible();
  const res = await page.request.get((await link.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect((await res.body()).equals(bytes)).toBe(true);

  await field(page, "file").setInputFiles({ name: "ssn.txt", mimeType: "text/plain", buffer: Buffer.from("secret") });
  await field(page, "title").fill(`Restricted ${T}`);
  await field(page, "restricted").check();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expectFlash(page, "Uploaded");
  const href = await page.getByRole("link", { name: `Restricted ${T}` }).getAttribute("href");
  // Kayla Owens (customer service) has no PII access: she sees the title, not a link, and the file is refused.
  const csr = await as("kowens");
  await csr.goto(`/clients/${id}?tab=documents`);
  await expect(csr.getByText(`Restricted ${T} (restricted)`)).toBeVisible();
  await expect(csr.getByRole("link", { name: `Restricted ${T}` })).toHaveCount(0);
  expect((await csr.request.get(href!)).status()).toBe(403);
});

test("sensitive identifiers are masked for a role without PII access", async ({ as }) => {
  const id = val("select id from clients where kind = 'business' and fein is not null limit 1");
  const fein = val(`select fein from clients where id = ${id}`);
  const am = await as("choll");
  await am.goto(`/clients/${id}`);
  await expect(am.getByText(fein).first()).toBeVisible();
  const csr = await as("kowens");
  await csr.goto(`/clients/${id}`);
  await expect(csr.getByText(fein)).toHaveCount(0);
  await expect(csr.getByText("Sensitive identifiers are masked for your role.")).toBeVisible();
});

test("log a call on the account", async ({ as }) => {
  const id = need("bizClient");
  const page = await as("mrivera");
  await page.goto(`/clients/${id}?tab=activity`);
  await field(page, "body").fill(`Discussed the upcoming project ${T}`);
  await page.getByRole("button", { name: "Save" }).click();
  await expectFlash(page, "Note added");
  await expect(page.getByText(`Discussed the upcoming project ${T}`)).toBeVisible();
});

test("search: the header box, the client list and the list filters find the record", async ({ as }) => {
  const name = need("bizName");
  const page = await as("mrivera");
  await page.goto("/");
  await page.locator("#global-search").fill(`UAT Contracting ${T}`);
  await page.locator("#global-search").press("Enter");
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByRole("heading", { name: /Search:/ })).toBeVisible();
  await expect(page.getByRole("link", { name }).first()).toBeVisible();
  await page.goto("/search?q=zzz-no-such-thing");
  await expect(page.getByText("Nothing found.")).toBeVisible();
  await page.goto("/search");
  await expect(page.getByText(/Type a client, contact, policy number/)).toBeVisible();

  await page.goto("/search?q=" + encodeURIComponent("Dana Tester"));
  await expect(page.getByRole("link", { name: "Dana Tester" }).first()).toBeVisible();

  await page.goto("/clients?status=all");
  await page.getByPlaceholder("Name, code, email, phone, contact…").fill(`dana-${T}`);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("link", { name }).first()).toBeVisible();
  await page.goto("/clients?mine=1");
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
  await page.goto("/clients?kind=individual&sort=premium");
  await expect(page.getByRole("heading", { name: "Clients" })).toBeVisible();
});

test("inactivate and reactivate", async ({ as }) => {
  const id = need("dupClient");
  const page = await as("mrivera");
  await page.goto(`/clients/${id}`);
  await field(page, "reason").fill("Moved out of state");
  await page.getByRole("button", { name: "Inactivate" }).click();
  await expectFlash(page, "Client inactivated");
  await expect(page.locator("h1").getByText("inactive")).toBeVisible();
  await expect(page.getByText("Inactive: Moved out of state")).toBeVisible();
  await page.goto("/clients?status=inactive");
  await expect(page.locator(`a[href="/clients/${id}"]`)).toBeVisible();
  await page.goto(`/clients/${id}`);
  await page.getByRole("button", { name: "Reactivate" }).click();
  await expectFlash(page, "Client reactivated");
  await expect(page.locator("h1").getByText("inactive")).toHaveCount(0);
  // Reactivating a prospect that never had a policy brings back a prospect.
  await expect(page.locator("h1").getByText("prospect")).toBeVisible();
});

test("a principal merges a duplicate; an account manager can't", async ({ as }) => {
  const keep = need("bizClient"), drop = need("dupClient");
  const am = await as("mrivera");
  await am.goto(`/clients/${keep}`);
  await expect(am.getByText("Merge a duplicate into this client")).toHaveCount(0);
  const page = await as("choll");
  await page.goto(`/clients/${keep}`);
  await page.getByText("Merge a duplicate into this client").click();
  await pickClient(page, drop);
  await page.getByRole("button", { name: "Merge" }).click();
  await expectFlash(page, "Clients merged");
  expect(sql(`select status, inactive_reason from clients where id = ${drop}`)[0]).toEqual(["inactive", `Merged into ${keep}`]);
});

test("account Q&A says plainly that it needs Claude when AI is off", async ({ as }) => {
  const id = need("bizClient");
  const page = await as("mrivera");
  await page.goto(`/clients/${id}`);
  await expect(page.getByText(/Account Q&A uses Claude: set ANTHROPIC_API_KEY/)).toBeVisible();
  await expect(field(page, "question")).toBeDisabled();
});
