import { pickClient, test, expect, expectFlash, expectError, field, idFrom, sql, val, saveState, need, T, todayISO, expectPdf, type Page } from "./fixtures";

const today = todayISO();
const MINE = "(select id from users where username = 'mrivera')";

/** A business of hers with an active GL policy, with or without a given form on it. */
function glClient(hasForm: string | null, lacksForm: string | null) {
  const row = sql(`SELECT c.id, c.name, p.id, p.policy_number FROM clients c JOIN policies p ON p.client_id = c.id AND p.status = 'active' AND p.lob = 'GL'
    WHERE c.kind = 'business' AND c.status = 'insured' AND c.account_manager_id = ${MINE}
    ${hasForm ? `AND EXISTS (SELECT 1 FROM policy_forms f WHERE f.policy_id = p.id AND f.form_number LIKE '${hasForm}%')` : ""}
    ${lacksForm ? `AND NOT EXISTS (SELECT 1 FROM policy_forms f WHERE f.policy_id = p.id AND f.form_number LIKE '${lacksForm}%')` : ""}
    ORDER BY c.id LIMIT 1`)[0];
  expect(row, "a suitable seeded client").toBeTruthy();
  return { id: row[0], name: row[1], policyId: row[2], number: row[3] };
}

async function onlyPolicy(page: Page, id: string) {
  for (const box of await page.locator('input[name="policy_ids"]').all()) await box.uncheck();
  await page.locator(`input[name="policy_ids"][value="${id}"]`).check();
}

test.describe("certificates", () => {
  test("no holder is refused; no policies is flagged", async ({ as }) => {
    const c = glClient("CG 20 10", null);
    const page = await as("mrivera");
    await page.goto(`/certificates/new?client=${c.id}`);
    await page.getByRole("button", { name: "Issue certificate" }).click();
    await expectError(page, "Choose a certificate holder or enter a new one.");
    await field(page, "holder_name").fill(`UAT No Policy Holder ${T}`);
    for (const box of await page.locator('input[name="policy_ids"]').all()) await box.uncheck();
    await page.getByRole("button", { name: "Issue certificate" }).click();
    await expectError(page, "No policies selected: the certificate would show no coverage.");
  });

  test("issue to a new holder, by way of the wizard; the policies, wording and history show", async ({ as }) => {
    const c = glClient("CG 20 10", null);
    saveState({ certC: c.id, certCName: c.name });
    const page = await as("mrivera");
    const holder = `UAT Holder ${T} LLC`;
    await page.goto("/certificates");
    await page.getByRole("link", { name: "＋ Issue certificate" }).click();
    await pickClient(page, c.id);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: `Issue certificate · ${c.name}` })).toBeVisible();
    await field(page, "holder_name").fill(holder);
    await field(page, "holder_email").fill(`coi-${T}@holder.example`);
    await field(page, "holder_city").fill("Raleigh");
    await onlyPolicy(page, c.policyId);
    await field(page, "ai").check();
    await field(page, "description").fill("Job 42: tenant upfit, 100 Main St.");
    await field(page, "delivered_to").fill(`coi-${T}@holder.example`);
    await page.getByRole("button", { name: "Issue certificate" }).click();
    await expectFlash(page, "Certificate issued");
    const id = idFrom(page.url(), "certificates");
    saveState({ certA: id, certHolder: holder });
    await expect(page.getByRole("heading", { name: /COI-/ })).toBeVisible();
    await expect(page.locator("h1").getByText("issued")).toBeVisible();
    await expect(page.getByText(`${c.name} → ${holder}`)).toBeVisible();
    await expect(page.getByRole("link", { name: c.number })).toBeVisible();
    await expect(page.getByText("Additional insured", { exact: true })).toBeVisible();
    await expect(page.getByText("Job 42: tenant upfit, 100 Main St.")).toBeVisible();
    await expect(page.getByText(`coi-${T}@holder.example`).first()).toBeVisible();
    await expect(page.locator("section").filter({ hasText: "History" }).getByText(/Issued COI-.* to /)).toBeVisible();
    await expectPdf(page, (await page.getByRole("link", { name: "Open PDF" }).getAttribute("href"))!);
  });

  test("wording failure: a promise the policy can't back is stopped, the override issues it and records why", async ({ as }) => {
    const c = glClient("CG 00 01", "CG 20 01");
    const page = await as("mrivera");
    await page.goto(`/certificates/new?client=${c.id}`);
    await field(page, "holder_name").fill(`UAT Wording Holder ${T}`);
    await onlyPolicy(page, c.policyId);
    await field(page, "pnc").check();
    await page.getByRole("button", { name: "Issue certificate" }).click();
    await expectError(page, new RegExp(`Check before issuing: ${c.number.replace(/[-]/g, "\\-")} \\(GL\\): no primary and non-contributory endorsement`));
    expect(val(`select count(*) from certificates ce join other_interests oi on oi.id = ce.holder_id where oi.name = 'UAT Wording Holder ${T}'`), "nothing was issued").toBe("0");
    // The new holder was kept, so the retry is one tick away.
    await expect(field(page, "holder_id").locator("option:checked")).toHaveText(new RegExp(`UAT Wording Holder ${T}`));
    await onlyPolicy(page, c.policyId);
    await field(page, "pnc").check();
    await field(page, "override").check();
    await page.getByRole("button", { name: "Issue certificate" }).click();
    await expectFlash(page, "Certificate issued");
    await expect(page.getByText("Wording not backed by an endorsement on file:")).toBeVisible();
    await expect(page.locator("section").filter({ hasText: "History" }).getByText(/Issued despite:/)).toBeVisible();
  });

  test("a new certificate to the same holder supersedes the old one", async ({ as }) => {
    const client = need("certC"), first = need("certA"), holder = need("certHolder");
    const page = await as("mrivera");
    await page.goto(`/certificates/${first}`);
    await page.getByRole("link", { name: "Reissue with changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/certificates/new\\?client=${client}&holder=`));
    await expect(field(page, "holder_id").locator("option:checked")).toHaveText(new RegExp(holder));
    await expect(field(page, "description"), "last wording carries over").toHaveValue("Job 42: tenant upfit, 100 Main St.");
    await field(page, "ai").check();
    await onlyPolicy(page, val(`select policy_id from certificate_policies where certificate_id = ${first} limit 1`));
    await page.getByRole("button", { name: "Issue certificate" }).click();
    await expectFlash(page, "Certificate issued");
    const second = idFrom(page.url(), "certificates");
    saveState({ certB: second });
    await page.goto(`/certificates/${first}`);
    await expect(page.locator("h1").getByText("superseded")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Send again" }), "a superseded certificate can't be sent").toHaveCount(0);
    await page.goto(`/certificates?status=superseded&q=${encodeURIComponent(holder)}`);
    await expect(page.locator(`a[href="/certificates/${first}"]`)).toBeVisible();
    await page.goto(`/certificates?q=${encodeURIComponent(holder)}`);
    await expect(page.locator(`a[href="/certificates/${second}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/certificates/${first}"]`)).toHaveCount(0);
    await page.goto(`/clients/${client}?tab=certificates`);
    await expect(page.locator(`a[href="/certificates/${second}"]`)).toBeVisible();
  });

  test("deliver: send again logs where it went", async ({ as }) => {
    const id = need("certB");
    const page = await as("mrivera");
    await page.goto(`/certificates/${id}`);
    await field(page, "delivered_to").fill(`again-${T}@holder.example`);
    await page.getByRole("button", { name: "Mark as sent", exact: true }).click();
    await expectFlash(page, `Delivery to again-${T}@holder.example logged`);
    await expect(page.locator("section").filter({ hasText: "History" }).getByText(`Marked as sent to again-${T}@holder.example`)).toBeVisible();
    await expect(page.getByText(`again-${T}@holder.example`).first()).toBeVisible();
  });

  test("renew: once a policy renews, reissue every certificate onto the new term", async ({ as }) => {
    const client = need("certC");
    const page = await as("mrivera");
    const cert = need("certB");
    const policy = val(`select policy_id from certificate_policies where certificate_id = ${cert} limit 1`);
    await page.goto(`/policies/${policy}?tab=renewal`);
    // A term not yet in its renewal window keeps the form behind this.
    const early = page.getByText("Renew early anyway");
    if (await early.count()) await early.click();
    await field(page, "policy_number").fill(`UATCERTREN-${T}-02`);
    await page.getByRole("button", { name: "Create renewal term" }).click();
    await expectFlash(page, "Renewal term created.");
    await page.goto(`/certificates/${cert}`);
    await expect(page.getByText("A policy on this certificate has renewed.")).toBeVisible();
    await page.getByRole("button", { name: /Reissue all certificates for/ }).click();
    await expectFlash(page, /Reissued \d+ certificate\(s\) on the renewed policies/);
    await expect(page).toHaveURL(new RegExp(`/clients/${client}\\?tab=certificates`));
    const newest = val(`select id from certificates where renewed_from_id = ${cert}`);
    await page.goto(`/certificates/${newest}`);
    await expect(page.getByRole("link", { name: `UATCERTREN-${T}-02` }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "previous certificate" })).toBeVisible();
    await page.goto(`/certificates/${cert}`);
    await expect(page.locator("h1").getByText("superseded")).toBeVisible();
    saveState({ certNewest: newest });
  });

  test("revoke, with the reason in its history; the PDF still opens from the lists", async ({ as }) => {
    const id = need("certNewest");
    const page = await as("mrivera");
    await page.goto(`/certificates/${id}`);
    await field(page, "reason").fill("Issued in error");
    await page.getByRole("button", { name: "Revoke" }).click();
    await expectFlash(page, "Certificate revoked");
    await expect(page.locator("h1").getByText("revoked")).toBeVisible();
    await expect(page.locator("section").filter({ hasText: "History" }).getByText("Issued in error")).toBeVisible();
    await page.goto("/certificates?status=revoked");
    const row = page.getByRole("row").filter({ has: page.locator(`a[href="/certificates/${id}"]`) });
    await expectPdf(page, (await row.getByRole("link", { name: "PDF" }).getAttribute("href"))!);
  });
});

test.describe("claims", () => {
  test("new FNOL: recorded, not yet reported, with the task to report it", async ({ as }) => {
    const c = glClient(null, null);
    saveState({ claimClient: c.id });
    const page = await as("mrivera");
    await page.goto("/claims");
    await page.getByRole("link", { name: "＋ Record claim" }).click();
    await pickClient(page, c.id);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: `Record claim · ${c.name}` })).toBeVisible();
    await field(page, "policy_id").selectOption(c.policyId);
    await field(page, "kind").selectOption("General liability — bodily injury");
    await field(page, "loss_date").fill(today);
    await field(page, "description").fill(`Customer slipped at the job site ${T}`);
    await field(page, "location").fill("100 Main St");
    await field(page, "claimant").fill("Jo Claimant");
    await page.getByRole("button", { name: "Record claim" }).click();
    await expectFlash(page, "Claim recorded");
    const id = idFrom(page.url(), "claims");
    saveState({ claim: id });
    await expect(page.getByRole("heading", { name: /CLM-/ })).toBeVisible();
    await expect(page.getByText("Not reported to the carrier yet.")).toBeVisible();
    await expect(page.getByText(`Customer slipped at the job site ${T}`)).toBeVisible();
    await expect(page.getByRole("link", { name: c.number }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Report claim CLM-.* to the carrier/ })).toBeVisible();
    await page.goto("/claims");
    await expect(page.locator(`a[href="/claims/${id}"]`)).toBeVisible();
    await page.goto(`/clients/${c.id}?tab=claims`);
    await expect(page.locator(`a[href="/claims/${id}"]`)).toBeVisible();
  });

  test("a claim task opens the claim form, and recording it closes the task", async ({ as }) => {
    const client = need("claimClient");
    const page = await as("mrivera");
    const task = val(`select id from activities where client_id = ${client} and code = 'CLAIM-FNOL' and status = 'open' order by id desc limit 1`);
    expect(task, "the claim above left a task to report it").not.toBe("");
    await page.goto(`/claims/new?client=${client}&task=${task}`);
    await field(page, "description").fill("Second loss from a task");
    await page.getByRole("button", { name: "Record claim" }).click();
    await expectFlash(page, "Claim recorded");
    await page.goto(`/tasks/${task}`);
    await expect(page.getByText(/Completed .*Claim recorded/)).toBeVisible();
  });

  test("updates: carrier number, adjuster, reported; a follow-up; a document", async ({ as }) => {
    const id = need("claim");
    const page = await as("mrivera");
    await page.goto(`/claims/${id}`);
    await field(page, "carrier_claim_number").fill(`CC-${T}`);
    await field(page, "adjuster_name").fill("Alex Adjuster");
    await field(page, "adjuster_phone").fill("(800) 555-0100");
    await field(page, "reported").check();
    await page.locator("form", { has: field(page, "carrier_claim_number") }).getByRole("button", { name: "Save" }).click();
    await expectFlash(page, "Saved");
    await expect(field(page, "carrier_claim_number")).toHaveValue(`CC-${T}`);
    await expect(page.getByText("Not reported to the carrier yet.")).toHaveCount(0);
    await page.goto("/claims");
    await expect(page.getByRole("row").filter({ has: page.locator(`a[href="/claims/${id}"]`) }).getByText("Alex Adjuster")).toBeVisible();

    await page.goto(`/claims/${id}`);
    await field(page, "days").selectOption("7");
    await page.getByRole("button", { name: "Schedule follow-up" }).click();
    await expectFlash(page, "Follow-up scheduled");
    await expect(page.getByRole("link", { name: /Claim CLM-.* follow-up/ })).toBeVisible();

    await field(page, "file").setInputFiles({ name: "photo.txt", mimeType: "text/plain", buffer: Buffer.from("photo") });
    await page.locator("form", { has: field(page, "file") }).getByRole("button", { name: "Upload" }).click();
    await expectFlash(page, "Uploaded");
    await expect(page.getByRole("link", { name: "photo.txt" })).toBeVisible();
  });

  test("close the claim: its open work closes too, and it can be reopened", async ({ as }) => {
    const id = need("claim");
    const page = await as("mrivera");
    await page.goto(`/claims/${id}`);
    await field(page, "note").fill("Paid by carrier");
    await page.getByRole("button", { name: "Close claim" }).click();
    await expectFlash(page, "Claim closed");
    await expect(page.locator("h1").getByText("closed")).toBeVisible();
    expect(val(`select count(*) from activities where claim_id = ${id} and status in ('open','waiting')`)).toBe("0");
    await page.goto("/claims?status=closed");
    await expect(page.locator(`a[href="/claims/${id}"]`)).toBeVisible();
    await page.goto(`/claims/${id}`);
    await page.getByRole("button", { name: "Reopen" }).click();
    await expectFlash(page, "Claim reopened");
    await expect(page.locator("h1").getByText("open")).toBeVisible();
  });
});
