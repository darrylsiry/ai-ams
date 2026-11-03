import { pickClient, test, expect, expectFlash, expectError, field, idFrom, val, saveState, need, T, todayISO, addDays, expectPdf, type Page } from "./fixtures";

// Policies: new business on the prospects from 30-clients, through the whole term.
const today = todayISO();
const summary = (page: Page, label: string) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

async function newPolicy(page: Page, client: string, o: { number?: string; lob: string; status?: "bound" | "active"; carrier: string; premium: string; bill?: "agency" | "direct"; binder?: string }) {
  await page.goto(`/policies/new?client=${client}`);
  await field(page, "lob").selectOption(o.lob);
  if (o.number) await field(page, "policy_number").fill(o.number);
  await field(page, "status").selectOption(o.status ?? "active");
  await field(page, "carrier_id").selectOption({ label: o.carrier });
  await field(page, "premium").fill(o.premium);
  await field(page, "bill_mode").selectOption(o.bill ?? "direct");
  if (o.binder) { await field(page, "binder_number").fill(o.binder); await field(page, "binder_expires").fill(addDays(today, 30)); }
  await field(page, "cov_desc_0").fill("Each occurrence");
  await field(page, "cov_limit_0").fill("$1,000,000");
  await field(page, "cov_ded_0").fill("$1,000");
  await page.getByRole("button", { name: "Create policy" }).click();
  await expectFlash(page, "Policy created. A policy check task is on the account manager's queue.");
  return idFrom(page.url(), "policies");
}

test("new policy: an agency-bill binder on a prospect; the prospect becomes an insured and it's invoiced", async ({ as }) => {
  const client = need("bizClient");
  const page = await as("mrivera");
  await page.goto("/policies");
  await page.getByRole("link", { name: "＋ New policy" }).click();
  await pickClient(page, client);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(new RegExp(`client=${client}`));
  const number = `UATGL-${T}-01`;
  const id = await newPolicy(page, client, { number, lob: "GL", status: "bound", carrier: "Piedmont Fire & Casualty", premium: "12,000.00", bill: "agency", binder: `BND-${T}` });
  saveState({ agencyPolicy: id, agencyPolicyNumber: number });
  await expect(page.getByRole("heading", { name: number })).toBeVisible();
  await expect(page.locator("h1").getByText("bound")).toBeVisible();
  await expect(page.getByText(`Bound under binder BND-${T}`)).toBeVisible();
  await expect(summary(page, "Premium")).toHaveText("$12,000.00");
  await expect(summary(page, "Commission")).toHaveText("15.0% · $1,800");
  await expect(summary(page, "Billing")).toContainText("Agency bill");
  await page.goto(`/clients/${client}`);
  await expect(page.locator("h1").getByText("insured")).toBeVisible();
  await page.goto(`/clients/${client}?tab=billing`);
  const inv = page.getByRole("row").filter({ hasText: `New business ${number}` });
  await expect(inv.getByRole("cell", { name: "$12,000.00" }).first()).toBeVisible();
  await expect(inv.getByText("open", { exact: true })).toBeVisible();
  await page.goto(`/policies/${id}?tab=activity`);
  await expect(page.getByRole("link", { name: `Policy check ${number}`, exact: false }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: `Set up new policy ${number}`, exact: false }).first()).toBeVisible();
});

test("a blank policy number gets a placeholder, and the policy shows on the lists", async ({ as }) => {
  const client = need("bizClient");
  const page = await as("mrivera");
  const id = await newPolicy(page, client, { lob: "CA", carrier: "Piedmont Fire & Casualty", premium: "4000", bill: "direct" });
  const number = val(`select policy_number from policies where id = ${id}`);
  expect(number).toMatch(/^PENDING-/);
  saveState({ directPolicy: id, directPolicyNumber: number });
  await expect(page.locator("h1").getByText("in force")).toBeVisible();
  await page.goto(`/policies?q=${encodeURIComponent(number)}`);
  await expect(page.getByRole("link", { name: number })).toBeVisible();
  await page.goto(`/clients/${client}?tab=policies`);
  await expect(page.getByRole("link", { name: number })).toBeVisible();
  for (const tabName of ["Bound, not issued", "Not yet checked", "Pending cancel", "Cancelled", "Expired", "Lost", "All"]) {
    await page.goto("/policies");
    await page.locator("main nav").getByRole("link", { name: tabName, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Policies" })).toBeVisible();
  }
});

test("mark issued: the binder becomes a policy in force", async ({ as }) => {
  const id = need("agencyPolicy");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}`);
  await expect(summary(page, "Issued")).toHaveText("Not yet");
  await page.getByRole("button", { name: "Carrier policy received" }).click();
  await expectFlash(page, "Carrier policy received — policy is in force");
  await expect(page.locator("h1").getByText("in force")).toBeVisible();
  await expect(page.getByText("Bound under binder")).toHaveCount(0);
  await expect(summary(page, "Issued")).not.toHaveText("Not yet");
});

test("policy check: recorded by hand, with the task kept up to date; a non-PDF is refused", async ({ as }) => {
  const id = need("agencyPolicy");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}?tab=check`);
  await expect(page.getByText("Not checked yet.")).toBeVisible();
  await page.getByRole("button", { name: "Record check" }).click();
  await expectError(page, "Upload the policy PDF or write what you checked.");
  await field(page, "file").setInputFiles({ name: "policy.txt", mimeType: "text/plain", buffer: Buffer.from("not a pdf") });
  await page.getByRole("button", { name: "Record check" }).click();
  await expectError(page, "Upload the carrier's policy as a PDF.");
  await field(page, "file").setInputFiles({ name: "policy.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
  await page.getByRole("button", { name: "Record check" }).click();
  await expectError(page, "AI policy check needs ANTHROPIC_API_KEY");
  await expect(page.getByText("Not checked yet."), "an unread PDF doesn't count as checked").toBeVisible();
  await field(page, "result").fill(`Checked dec page against the binder ${T}: all matches`);
  await page.getByRole("button", { name: "Record check" }).click();
  await expectFlash(page, "Policy check recorded");
  await expect(page.getByText(/Last checked/)).toBeVisible();
  await expect(page.getByText(`Checked dec page against the binder ${T}: all matches`).first()).toBeVisible();
  await page.goto(`/policies/${id}`);
  await expect(summary(page, "Policy checked")).not.toHaveText("not yet");
  const task = val(`select id from activities where policy_id = ${id} and code = 'POL-CHECK'`);
  await page.goto(`/tasks/${task}`);
  await expect(page.getByText(`Checked dec page against the binder ${T}: all matches`)).toBeVisible();
});

test("endorsement on agency bill: premium goes up and an invoice appears", async ({ as }) => {
  const id = need("agencyPolicy"), client = need("bizClient"), number = need("agencyPolicyNumber");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}`);
  await page.getByRole("link", { name: "Endorse", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Endorse this policy" })).toBeVisible();
  await expect(page.getByText("Agency bill: an issued premium change creates an invoice")).toBeVisible();
  await field(page, "description").fill("Add additional location");
  await field(page, "premium_change").fill("1000");
  await page.getByRole("button", { name: "Record endorsement" }).click();
  await expectFlash(page, "Endorsement issued");
  await expect(summary(page, "Premium")).toHaveText("$13,000.00");
  const row = page.getByRole("row").filter({ hasText: "Add additional location" });
  await expect(row.getByText("$1,000.00")).toBeVisible();
  await expect(row.getByText("issued")).toBeVisible();
  await page.goto(`/clients/${client}?tab=billing`);
  await expect(page.getByRole("row").filter({ hasText: `Endorsement ${number}` }).getByText("$1,000.00").first()).toBeVisible();
});

test("a pending endorsement waits for the carrier: not issued changes nothing, issued applies it", async ({ as }) => {
  const id = need("agencyPolicy");
  const page = await as("mrivera");
  const invoices = () => Number(val(`select count(*) from invoices where policy_id = ${id}`));
  const before = invoices();
  await page.goto(`/policies/${id}?action=endorse`);
  await field(page, "description").fill("Carrier may decline this");
  await field(page, "premium_change").fill("111");
  await field(page, "issue_now").uncheck();
  await page.getByRole("button", { name: "Record endorsement" }).click();
  await expectFlash(page, "Endorsement recorded — pending the carrier's confirmation");
  await expect(summary(page, "Premium"), "nothing changes until issued").toHaveText("$13,000.00");
  await page.getByRole("row").filter({ hasText: "Carrier may decline this" }).getByRole("button", { name: "Not issued" }).click();
  await expectFlash(page, "Marked not issued");
  await expect(summary(page, "Premium")).toHaveText("$13,000.00");
  expect(invoices()).toBe(before);

  await page.goto(`/policies/${id}?action=endorse`);
  await field(page, "description").fill("Carrier approved this one");
  await field(page, "premium_change").fill("500");
  await field(page, "issue_now").uncheck();
  await page.getByRole("button", { name: "Record endorsement" }).click();
  await expectFlash(page, "pending the carrier");
  await page.getByRole("row").filter({ hasText: "Carrier approved this one" }).getByRole("button", { name: "Issued", exact: true }).click();
  await expectFlash(page, "Issued");
  await expect(summary(page, "Premium")).toHaveText("$13,500.00");
  expect(invoices()).toBe(before + 1);
});

test("a return-premium endorsement makes a credit, kept for the refund in accounting", async ({ as }) => {
  const id = need("agencyPolicy"), client = need("bizClient");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}?action=endorse`);
  await field(page, "description").fill("Remove location");
  await field(page, "sign").selectOption("-");
  await field(page, "premium_change").fill("300");
  await page.getByRole("button", { name: "Record endorsement" }).click();
  await expectFlash(page, "Endorsement issued");
  await expect(summary(page, "Premium")).toHaveText("$13,200.00");
  await page.goto(`/clients/${client}?tab=billing`);
  await expect(page.getByRole("row").filter({ hasText: "-$300.00" }).first()).toBeVisible();
  saveState({ creditInvoice: val(`select invoice_number from invoices where policy_id = ${id} and total < 0 order by id desc limit 1`) });
});

test("coverages, interests and the schedule on a policy", async ({ as }) => {
  const id = need("agencyPolicy");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}?tab=coverages`);
  await expect(page.getByRole("cell", { name: "Each occurrence" })).toBeVisible();
  await field(page, "description").fill("General aggregate");
  await field(page, "limit_text").fill("$2,000,000");
  await page.getByRole("button", { name: "Save" }).click();
  await expectFlash(page, "Coverage saved");
  await expect(page.getByRole("cell", { name: "General aggregate" })).toBeVisible();
  await page.getByRole("row").filter({ hasText: "General aggregate" }).getByRole("link", { name: "Edit" }).click();
  await expect(page.getByRole("heading", { name: "Edit coverage" })).toBeVisible();
  await field(page, "limit_text").fill("$3,000,000");
  await page.getByRole("button", { name: "Save" }).click();
  await expectFlash(page, "Coverage saved");
  await expect(page.getByRole("row").filter({ hasText: "General aggregate" }).getByText("$3,000,000")).toBeVisible();

  await page.goto(`/policies/${id}?tab=interests`);
  await field(page, "new_name").fill(`UAT Bank ${T}`);
  await field(page, "role").selectOption("Loss payee");
  await field(page, "loan_number").fill("LN-12345");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectFlash(page, "Interest added");
  const row = page.getByRole("row").filter({ hasText: `UAT Bank ${T}` });
  await expect(row.getByText("Loss payee")).toBeVisible();
  await row.getByRole("button", { name: "Remove" }).click();
  await expectFlash(page, "Interest removed");
  await expect(page.getByRole("row").filter({ hasText: `UAT Bank ${T}` })).toHaveCount(0);

  await page.goto(`/policies/${id}?tab=schedule`);
  const item = page.locator("li").filter({ hasText: "2026 Ford F-250" }).getByRole("checkbox");
  await item.check();
  await page.getByRole("button", { name: "Save schedule for this policy" }).click();
  await expectFlash(page, "Schedule updated");
  await expect(page.locator("li").filter({ hasText: "2026 Ford F-250" }).getByRole("checkbox")).toBeChecked();
  await page.goto(`/policies/${id}?tab=documents`);
  await expect(page.getByRole("heading", { name: /Documents|/ }).first()).toBeVisible();
});

test("the dec page is a real PDF", async ({ as }) => {
  const id = need("agencyPolicy");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}`);
  await expectPdf(page, (await page.getByRole("link", { name: "Dec page PDF" }).getAttribute("href"))!);
});

test("a personal auto policy has ID cards, a real PDF; other lines don't", async ({ as }) => {
  const client = need("personalClient");
  const page = await as("mrivera");
  const number = `UATPA-${T}-01`;
  const id = await newPolicy(page, client, { number, lob: "PA", carrier: "Keystone Preferred Insurance", premium: "1800" });
  saveState({ personalPolicy: id });
  const cards = page.getByRole("link", { name: "ID cards" });
  await expect(cards).toBeVisible();
  await expectPdf(page, (await cards.getAttribute("href"))!);
  await expectPdf(page, (await page.getByRole("link", { name: "Dec page PDF" }).getAttribute("href"))!);
  await expect(page.getByRole("link", { name: "Certificate", exact: true }), "certificates are for businesses").toHaveCount(0);
  await page.goto(`/policies/${need("agencyPolicy")}`);
  await expect(page.getByRole("link", { name: "ID cards" })).toHaveCount(0);
  await page.goto(`/policies/new?client=${client}`);
  const lobs = await page.locator('select[name="lob"] option').allTextContents();
  expect(lobs).toContain("Personal Auto");
  expect(lobs, "a personal client only offers personal lines").not.toContain("General Liability");
});

test("pending non-pay: the notice warns, then reinstating restores it", async ({ as }) => {
  const id = need("directPolicy");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}`);
  await page.getByRole("link", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cancel this policy" })).toBeVisible();
  await field(page, "cancel_date").fill(addDays(today, 10));
  await field(page, "reason").selectOption("Non-payment");
  await field(page, "pending").check();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expectFlash(page, "Pending cancellation recorded — reminders will follow");
  await expect(page.locator("h1").getByText("pending cancel")).toBeVisible();
  await expect(page.getByText(`Pending cancellation for non-payment on ${addDays(today, 10)}`)).toBeVisible();
  await page.goto("/policies?status=pending_cancel");
  await expect(page.locator(`a[href="/policies/${id}"]`)).toBeVisible();

  await page.goto(`/policies/${id}`);
  await page.getByRole("link", { name: "Reinstate", exact: true }).click();
  await field(page, "note").fill("Payment received by carrier, no lapse");
  await page.getByRole("button", { name: "Reinstate", exact: true }).click();
  await expectFlash(page, "Policy reinstated");
  await expect(page.locator("h1").getByText("in force")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Payment received by carrier, no lapse" }).getByText("issued")).toBeVisible();
  await expect(page.getByText("Pending cancellation for")).toHaveCount(0);
});

test("cancel with a return premium: cancelled, with a credit on agency bill", async ({ as }) => {
  const client = need("bizClient");
  const page = await as("mrivera");
  const number = `UATPROP-${T}-01`;
  const id = await newPolicy(page, client, { number, lob: "PROP", carrier: "Piedmont Fire & Casualty", premium: "2400", bill: "agency" });
  saveState({ cancelledPolicy: id });
  await page.goto(`/policies/${id}?action=cancel`);
  await field(page, "reason").selectOption("Insured request");
  await field(page, "method").selectOption("Pro rata");
  await field(page, "return_premium").fill("2000");
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expectFlash(page, "Policy cancelled");
  await expect(page.locator("h1").getByText("cancelled")).toBeVisible();
  await expect(summary(page, "Cancellation")).toContainText("Insured request · Pro rata · return $2,000");
  await expect(page.getByRole("link", { name: "Endorse" }), "no more transactions on a cancelled term").toHaveCount(0);
  await page.goto(`/clients/${client}?tab=billing`);
  await expect(page.getByRole("row").filter({ hasText: `Return premium ${number}` }).getByText("-$2,000.00").first()).toBeVisible();
  await page.goto("/policies?status=cancelled");
  await expect(page.locator(`a[href="/policies/${id}"]`)).toBeVisible();
});

test("a cancelled policy can be reinstated", async ({ as }) => {
  // POL-52 in docs/AMS-MVP-Scope.md: "Reinstate policy | Full".
  const id = need("cancelledPolicy");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}`);
  await expect(page.getByRole("link", { name: "Reinstate", exact: true }), "a way to reinstate is offered").toBeVisible();
  await page.getByRole("link", { name: "Reinstate", exact: true }).click();
  await field(page, "note").fill("Reinstated with no lapse");
  await page.getByRole("button", { name: "Reinstate", exact: true }).click();
  await expectFlash(page, "Policy reinstated");
  await expect(page.locator("h1").getByText("in force")).toBeVisible();
});

test("a CSR can work policies; accounting (no write permission) sees them read-only", async ({ as }) => {
  const id = need("directPolicy");
  const csr = await as("kowens");
  await csr.goto(`/policies/${id}`);
  await expect(csr.getByRole("link", { name: "Endorse", exact: true })).toBeVisible();
  const acct = await as("lmorgan");
  await acct.goto(`/policies/${id}`);
  await expect(acct.getByRole("heading", { name: "Summary" })).toBeVisible();
  await expect(acct.getByRole("link", { name: "Endorse", exact: true })).toHaveCount(0);
  await expect(acct.getByRole("link", { name: "Cancel", exact: true })).toHaveCount(0);
});
