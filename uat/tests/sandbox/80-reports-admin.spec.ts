import { test, expect, expectFlash, expectError, field, idFrom, sql, val, saveState, need, T, addDays, todayISO, type Page } from "./fixtures";

const today = todayISO();

test.describe("reports", () => {
  const REPORTS: [string, string, string, string][] = [
    ["Activity", "/reports/activity", "activity", "By person"],
    ["Users & sign-ins", "/reports/users", "users", "By person"],
    ["Production", "/reports/production", "production", "New business premium by month"],
    ["Book of business", "/reports/book", "book", "Premium by line"],
    ["Renewals & retention", "/reports/renewals", "retention", "By month"],
    ["Commissions", "/reports/commissions", "commissions", "Commission income by month"],
    ["Email intake", "/reports/email", "email", "Emails received per day"],
    ["Claims", "/reports/claims", "claims", "Claims reported by type"],
  ];

  for (const [title, path, csv, card] of REPORTS) {
    test(`${title}: opens from the list, shows its data and downloads as CSV`, async ({ as }) => {
      // Users & sign-ins is an administrator's report; the rest are for anyone with reports.all.
      const page = await as(path === "/reports/users" ? "admin" : "choll");
      await page.goto("/reports");
      await page.locator(`main a[href="${path}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      void title;
      await expect(page.getByRole("heading", { name: card }).first()).toBeVisible();
      const link = page.getByRole("link", { name: "Download CSV" });
      const href = await link.getAttribute("href");
      expect(href).toContain(`r=${csv}`);
      const res = await page.request.get(href!);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("text/csv");
      const text = await res.text();
      expect(text.trim().split("\n").length, "a header and at least one row").toBeGreaterThan(1);
      expect(text.split("\n")[0]).toContain(",");
    });
  }

  test("a date filter narrows a report, and the presets work", async ({ as }) => {
    const page = await as("choll");
    await page.goto("/reports/activity");
    const from = "2026-03-01", to = "2026-03-31";
    await page.getByLabel("From").fill(from);
    await page.getByLabel("To", { exact: true }).fill(to);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(new RegExp(`from=${from}&to=${to}`));
    await expect(page.getByText(`${from} to ${to}`)).toBeVisible();
    const march = Number((await page.locator("div.rounded-lg").filter({ hasText: /^Tasks completed/ }).locator("div.text-2xl").innerText()).replace(/,/g, ""));
    await page.goto("/reports/activity?from=2026-01-01");
    const ytd = Number((await page.locator("div.rounded-lg").filter({ hasText: /^Tasks completed/ }).locator("div.text-2xl").innerText()).replace(/,/g, ""));
    expect(ytd, "a wider range counts more").toBeGreaterThan(march);
    const csv = await page.request.get(`/reports/csv?r=production&from=${from}&to=${to}`);
    expect(csv.headers()["content-disposition"]).toContain(`production-${from}-to-${to}.csv`);
    expect((await page.request.get("/reports/csv?r=nonsense")).status()).toBe(400);
  });

  for (const [path] of REPORTS.filter(([, p]) => p !== "/reports/book").map(([, p]) => [p])) {
    test(`${path}: the 30d preset shows the last 30 days`, async ({ as }) => {
      const page = await as(path === "/reports/users" ? "admin" : "choll");
      await page.goto(path);
      await page.getByRole("link", { name: "30d", exact: true }).click();
      await expect(page).toHaveURL(/days=30/);
      await expect(page.getByLabel("From")).toHaveValue(addDays(today, -29));
      await expect(page.getByLabel("To", { exact: true })).toHaveValue(today);
    });
  }

  test("one person's activity, and a person's sign-ins and actions", async ({ as }) => {
    const page = await as("choll");
    await page.goto("/reports/activity");
    await field(page, "user").selectOption({ label: "Marisol Rivera" });
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("heading", { name: "Activity · Marisol Rivera" })).toBeVisible();
    await page.goto("/reports/users?user=mrivera");
    await expect(page.getByText("You can't open the users and sign-ins report"), "a principal doesn't see sign-ins").toBeVisible();

    const admin = await as("admin");
    await admin.goto("/reports/users?user=mrivera");
    await expect(admin.getByRole("heading", { name: "Actions in the system" })).toBeVisible();
    const csv = await admin.request.get((await admin.getByRole("link", { name: "Download CSV" }).getAttribute("href"))!);
    expect(await csv.text()).toContain("mrivera");
  });

  test("the receivables and audit shortcuts on the report list go where they say", async ({ as }) => {
    const page = await as("choll");
    await page.goto("/reports");
    await page.getByRole("link", { name: "Receivables aging" }).click();
    await expect(page.getByRole("heading", { name: "Invoices & aging" })).toBeVisible();
    await page.goto("/reports");
    await expect(page.getByRole("link", { name: "Audit trail" }), "the audit trail is for administrators").toHaveCount(0);
    const admin = await as("admin");
    await admin.goto("/reports");
    await admin.getByRole("link", { name: "Audit trail" }).click();
    await expect(admin.getByRole("heading", { name: "Audit trail" })).toBeVisible();
  });
});

test.describe("administration", () => {
  test("a non-admin sees the NoAccess panel at /admin/users/new, and no way in", async ({ as }) => {
    for (const who of ["mrivera", "choll", "lmorgan", "kowens"] as const) {
      const page = await as(who);
      await page.goto("/admin/users/new");
      await expect(page.getByText("You can't open new user setup"), who).toBeVisible();
      await expect(page.getByText("It needs the administrator role.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Create profile" })).toHaveCount(0);
    }
    const page = await as("mrivera");
    await page.goto("/admin");
    await expect(page.getByText("Some areas need the administrator role.")).toBeVisible();
    await page.goto("/admin/users");
    await expect(page.getByRole("link", { name: "＋ New user" })).toHaveCount(0);
    await page.goto(`/admin/users/${val("select id from users where username = 'choll'")}`);
    await expect(page.getByText("Only administrators can view other users.")).toBeVisible();
  });

  test("new user: profile created, with a login waiting, on the list", async ({ as }) => {
    const page = await as("admin");
    await page.goto("/admin");
    await expect(page.getByText("You have administrator access.")).toBeVisible();
    await page.goto("/admin/users");
    await page.getByRole("link", { name: "＋ New user" }).click();
    await expect(page.getByRole("heading", { name: "New user" })).toBeVisible();
    await field(page, "username").fill("Bad Name!");
    await field(page, "full_name").fill("Uat Newhire");
    await field(page, "email").fill(`uatnew-${T}@siryousagency.example`);
    await page.getByRole("button", { name: "Create profile" }).click();
    await expectError(page, "User ID: 2–30 letters, digits, . _ -");
    await field(page, "username").fill("uatnew");
    await field(page, "full_name").fill("Uat Newhire");
    await field(page, "email").fill(`uatnew-${T}@siryousagency.example`);
    await field(page, "title").fill("Trainee");
    await field(page, "inbox_alias").fill(`uatnew${T}`);
    await field(page, "role").selectOption("csr");
    await field(page, "commission_new_pct").fill("0");
    await page.getByRole("button", { name: "Create profile" }).click();
    await expectFlash(page, /Profile created\. Issue a password/);
    const id = idFrom(page.url(), "users");
    saveState({ newUser: id });
    await expect(page.getByRole("heading", { name: "Uat Newhire" })).toBeVisible();
    await expect(page.getByText("password set")).toBeVisible();
    await page.goto("/admin/users");
    const row = page.getByRole("row").filter({ hasText: "uatnew" });
    await expect(row.getByText("Customer service rep")).toBeVisible();
  });

  test("the same user ID or alias twice is refused with a plain message", async ({ as }) => {
    const page = await as("admin");
    await page.goto("/admin/users/new");
    await field(page, "username").fill("uatnew");
    await field(page, "full_name").fill("Second Copy");
    await field(page, "email").fill(`second-${T}@siryousagency.example`);
    await page.getByRole("button", { name: "Create profile" }).click();
    await expectError(page, "That user ID, email or inbox alias is already taken.");
  });

  test("the new person signs in and works in their role", async ({ as }) => {
    need("newUser");
    const page = await as("uatnew");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Uat/ })).toBeVisible();
    await page.locator("header").getByRole("button", { name: /Uat Newhire/ }).click();
    await expect(page.getByText("Customer service rep")).toBeVisible();
    await page.getByRole("link", { name: "My profile" }).click();
    await expect(page.getByRole("heading", { name: "Uat Newhire" })).toBeVisible();
    await expect(field(page, "role"), "people don't change their own role").toBeDisabled();
  });

  test("edit: admin changes the role and details; it takes effect and is audited", async ({ as }) => {
    const id = need("newUser");
    const page = await as("admin");
    await page.goto(`/admin/users/${id}`);
    await field(page, "title").fill("Account Manager");
    await field(page, "role").selectOption("account_manager");
    await field(page, "can_view_pii").check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectFlash(page, "Saved");
    await expect(field(page, "title")).toHaveValue("Account Manager");
    await expect(field(page, "role")).toHaveValue("account_manager");
    const them = await as("uatnew");
    await them.goto("/");
    await expect(them.locator("aside").getByRole("link", { name: "Accounting" }), "the new role has it").toBeVisible();
    await page.goto(`/admin/audit?q=${encodeURIComponent("Updated Uat Newhire")}`);
    await expect(page.getByRole("row").filter({ hasText: "user.updated" }).first()).toBeVisible();
  });

  test("an admin can't remove their own admin role", async ({ as }) => {
    const page = await as("admin");
    await page.goto(`/admin/users/${val("select id from users where username = 'admin'")}`);
    await field(page, "role").selectOption("csr");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectError(page, "You can't remove your own administrator role.");
    expect(val("select role from users where username = 'admin'")).toBe("admin");
  });

  test("add a license to a user", async ({ as }) => {
    const id = need("newUser");
    const page = await as("admin");
    await page.goto(`/admin/users/${id}`);
    await page.locator('select[name="state"]').selectOption("NC");
    await field(page, "license_number").fill(`LIC${T}`);
    await field(page, "expires_on").fill(addDays(today, 400));
    await page.getByRole("button", { name: "Add license" }).click();
    await expectFlash(page, "License added; renewal reminders are automatic");
    await expect(page.getByRole("cell", { name: `LIC${T}` })).toBeVisible();
  });

  test("deactivate: greyed out, gone from the pickers", async ({ as }) => {
    const id = need("newUser");
    const page = await as("admin");
    await page.goto(`/admin/users/${id}`);
    await field(page, "active").uncheck();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectFlash(page, "Saved");
    await expect(field(page, "active")).not.toBeChecked();
    await page.goto("/admin/users");
    await expect(page.getByRole("row").filter({ hasText: "uatnew" }).getByText("inactive")).toBeVisible();
    await page.goto("/tasks/new");
    const owners = await page.locator('select[name="owner_id"] option').allTextContents();
    expect(owners).not.toContain("Uat Newhire");
  });

  test("a deactivated person can no longer work in the system", async ({ signedOut }) => {
    need("newUser");
    const page = await signedOut();
    await page.goto("/signin");
    await page.getByLabel("User ID").fill("uatnew");
    await page.getByLabel("Password").fill("uat-sb-uatnew");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForLoadState("networkidle");
    await page.goto("/clients");
    await expect(page.getByRole("heading", { name: "Clients" }), "no client list for someone deactivated").toHaveCount(0);
  });

  test("settings: saved, and used by the app", async ({ as }) => {
    const page = await as("admin");
    await page.goto("/admin/settings");
    const name = (await field(page, "agency_name").inputValue());
    await field(page, "agency_name").fill(`Siryous Agency UAT ${T}`);
    await field(page, "remarket").fill("12");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expectFlash(page, "Settings saved");
    await expect(field(page, "agency_name")).toHaveValue(`Siryous Agency UAT ${T}`);
    await expect(field(page, "remarket")).toHaveValue("12");
    await page.goto("/");
    await expect(page.locator("aside").getByText(`Siryous Agency UAT ${T}`)).toBeVisible();
    await page.goto("/admin/settings");
    await field(page, "agency_name").fill(name);
    await field(page, "remarket").fill("10");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expectFlash(page, "Settings saved");
    await page.goto("/admin/audit?q=Agency+settings+updated");
    await expect(page.getByRole("row").filter({ hasText: "settings.updated" }).first()).toBeVisible();
  });

  test("settings: activity codes save, and automation runs on demand", async ({ as }) => {
    const page = await as("admin");
    await page.goto("/admin/settings");
    const row = page.getByRole("row").filter({ has: page.locator("td", { hasText: /^FOLLOW-UP$/ }) });
    await row.locator('input[name="default_due_days"]').fill("6");
    await row.getByRole("button", { name: "Save" }).click();
    await expectFlash(page, "FOLLOW-UP updated");
    await expect(page.getByRole("row").filter({ has: page.locator("td", { hasText: /^FOLLOW-UP$/ }) }).locator('input[name="default_due_days"]')).toHaveValue("6");
    await page.getByRole("button", { name: "Run now" }).click();
    await expectFlash(page, /Automation ran: /);
    await expect(page.getByText(`Last run:`)).toContainText(today);
    const ro = await as("mrivera");
    await ro.goto("/admin/settings");
    await expect(ro.getByText("You can't open settings")).toBeVisible();
    await expect(field(ro, "agency_name")).toHaveCount(0);
    await expect(ro.getByRole("button", { name: "Save settings" })).toHaveCount(0);
    await expect(ro.getByRole("button", { name: "Run now" })).toHaveCount(0);
  });

  test("carriers: add and edit; the new one is offered on a new policy", async ({ as }) => {
    const page = await as("admin");
    const name = `UAT Mutual ${T}`;
    await page.goto("/admin/carriers");
    await field(page, "name").fill(name);
    await field(page, "kind").selectOption("carrier");
    await field(page, "bill_modes").selectOption("both");
    await field(page, "lines").fill("gl, ca");
    await field(page, "commission_new_pct").fill("14");
    await field(page, "commission_renewal_pct").fill("11");
    await page.getByRole("button", { name: "Save" }).click();
    await expectFlash(page, "Carrier saved");
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row.getByText("14% / 11%")).toBeVisible();
    await expect(row.getByText("GL, CA")).toBeVisible();
    await row.getByRole("link", { name: "Edit" }).click();
    await expect(page.getByRole("heading", { name: `Edit ${name}` })).toBeVisible();
    await field(page, "commission_new_pct").fill("13");
    await page.getByRole("button", { name: "Save" }).click();
    await expectFlash(page, "Carrier saved");
    await expect(page.getByRole("row").filter({ hasText: name }).getByText("13% / 11%")).toBeVisible();
    await page.goto(`/policies/new?client=${need("bizClient")}`);
    expect(await page.locator('select[name="carrier_id"] option').allTextContents()).toContain(name);
    const am = await as("mrivera");
    await am.goto("/admin/carriers");
    await expect(am.getByRole("button", { name: "Save" })).toHaveCount(0);
  });

  test("roadmap lists what's deferred; system status tells the truth", async ({ as }) => {
    const page = await as("admin");
    await page.goto("/admin/roadmap");
    await expect(page.getByRole("heading", { name: /Roadmap/ })).toBeVisible();
    for (const id of ["SAL-19", "PRT-01", "GL-12", "CSH-09", "WRK-25O"]) await expect(page.getByRole("cell", { name: id, exact: true })).toBeVisible();
    await expect(page.getByText("Pending dependency").first()).toBeVisible();
    await expect(page.getByText("Not in MVP", { exact: true }).first()).toBeVisible();
    await page.goto("/admin/system");
    await expect(page.getByRole("heading", { name: "System status" })).toBeVisible();
    await expect(page.getByText(/on — \d+ logins/)).toBeVisible();
    await expect(page.getByText("off — set ANTHROPIC_API_KEY")).toBeVisible();
    await expect(page.getByText("configured").first()).toBeVisible();
  });

  test("the audit trail recorded this run's changes, by person, and filters and downloads", async ({ as }) => {
    const page = await as("admin");
    await page.goto("/admin/audit");
    await expect(page.getByText("Append-only: the database refuses to edit or delete these rows.")).toBeVisible();
    await field(page, "actor").selectOption("lmorgan");
    await page.getByPlaceholder("Search summary or action").fill("Receipt");
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page.getByRole("row").filter({ hasText: "receipt.created" }).first()).toBeVisible();
    await page.goto(`/admin/audit?q=${encodeURIComponent(need("bizName"))}`);
    const created = page.getByRole("row").filter({ hasText: "client.created" }).first();
    await expect(created.getByText("mrivera")).toBeVisible();
    await page.goto("/admin/audit?actor=mrivera&type=policy");
    await expect(page.getByRole("row").filter({ hasText: "policy.endorsed" }).first()).toBeVisible();
    const res = await page.request.get("/reports/csv?r=audit&from=2026-01-01");
    expect(res.headers()["content-type"]).toContain("text/csv");
    // Append-only is enforced by the database, not just promised.
    expect(() => sql("update audit_events set actor = 'tampered' where id = (select min(id) from audit_events)")).toThrow();
  });
});

test.describe("features not in the MVP are tagged and can't be used", () => {
  async function tagged(page: Page, name: RegExp, badge: "Coming later" | "Needs setup") {
    const b = page.getByRole("link", { name }).first();
    await expect(b).toContainText(badge);
    await expect(b).toHaveAttribute("title", new RegExp(`^${badge}:`));
    await expect(b, "it explains itself on the roadmap").toHaveAttribute("href", /^\/admin\/roadmap#/);
  }
  test("links with a badge and a reason, on the pages that show them", async ({ as }) => {
    const page = await as("choll");
    await page.goto("/inbox");
    await tagged(page, /Connect mailbox/, "Coming later");
    await page.goto("/policies");
    await tagged(page, /Carrier download/, "Needs setup");
    await page.goto("/sales");
    await tagged(page, /Comparative rater/, "Coming later");
    await tagged(page, /Drip campaigns/, "Coming later");
    await page.goto("/certificates");
    await tagged(page, /Insured self-service certificates/, "Coming later");
    await page.goto("/reports");
    await tagged(page, /Custom dashboards/, "Coming later");
    await page.goto(`/clients/${need("bizClient")}`);
    await tagged(page, /Client portal invite/, "Coming later");
    await page.goto(`/clients/${need("bizClient")}?tab=billing`);
    await expect(page.getByText("Send payment link")).toHaveAttribute("title", /^Needs setup:/);
  });
});
