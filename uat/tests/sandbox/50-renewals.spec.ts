import { test, expect, expectFlash, field, idFrom, sql, val, saveState, need, T, type Page } from "./fixtures";

// Renewals: the pipeline, the prepared renewal, stage changes, the renewal itself, the comparison
// flag and the work that follows. On seeded policies in Marisol Rivera's book with a certificate on them.
const MINE = "(select id from users where username = 'mrivera')";
const summary = (page: Page, label: string) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

/** A first-term policy of hers that's due for renewal, optionally with an issued certificate on it. */
function duePolicy(withCert: boolean, skip: string[] = []) {
  const rows = sql(`SELECT p.id, p.policy_number, p.premium, p.expiration_date, c.name, c.id FROM policies p JOIN clients c ON c.id = p.client_id
    WHERE p.status = 'active' AND p.prior_policy_id IS NULL AND p.renewal_policy_id IS NULL AND p.renewal_stage NOT IN ('renewed','lost','non_renewed')
      AND coalesce(p.renewal_owner_id, p.account_manager_id) = ${MINE} AND p.expiration_date BETWEEN current_date + 10 AND current_date + 90
      ${skip.length ? `AND p.id NOT IN (${skip.join(",")})` : ""}
      AND ${withCert ? "" : "NOT "}EXISTS (SELECT 1 FROM certificate_policies cp JOIN certificates ce ON ce.id = cp.certificate_id WHERE cp.policy_id = p.id AND ce.status = 'issued')
    ORDER BY p.expiration_date LIMIT 1`);
  expect(rows.length, `a seeded policy due for renewal (certificate: ${withCert})`).toBe(1);
  const [id, number, premium, expires, client, clientId] = rows[0];
  return { id, number, premium: Number(premium), expires, client, clientId };
}

test("the pipeline shows my renewals by stage, with the filters", async ({ as }) => {
  const page = await as("mrivera");
  await page.goto("/renewals");
  await expect(page.getByRole("heading", { name: "Renewals" })).toBeVisible();
  await expect(page.locator("main nav").getByRole("link", { name: "My renewals" })).toHaveAttribute("aria-current", "page");
  for (const stage of ["Not started", "In review", "Remarketing", "Quoted", "Presented"]) await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Policy retention, year to date")).toBeVisible();
  await field(page, "days").selectOption("30");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/expiring in the next 30 days/)).toBeVisible();
  await page.locator("main nav").getByRole("link", { name: "Everyone" }).click();
  await expect(page).toHaveURL(/view=all/);
  await expect(page.getByText(/expiring in the next 30 days/)).toBeVisible();
});

test("prepare: the renewal tab starts from the expiring term", async ({ as }) => {
  const p = duePolicy(true);
  saveState({ renewPolicy: p.id, renewNumber: p.number, renewPremium: p.premium, renewClient: p.clientId });
  const page = await as("mrivera");
  await page.goto("/renewals?days=120");
  await page.locator(`a[href="/policies/${p.id}?tab=renewal"]`).click();
  await expect(page.getByRole("heading", { name: "Renew this policy" })).toBeVisible();
  await expect(field(page, "effective_date"), "starts the day the old term ends").toHaveValue(p.expires);
  await expect(field(page, "premium")).toHaveValue(p.premium.toFixed(2));
  await expect(field(page, "policy_number")).not.toHaveValue("");
});

test("stage changes move the renewal along; remarketing raises a task", async ({ as }) => {
  const id = need("renewPolicy");
  const page = await as("mrivera");
  await page.goto(`/policies/${id}?tab=renewal`);
  await field(page, "stage").selectOption("in_review");
  await page.getByRole("button", { name: "Update stage" }).click();
  await expectFlash(page, "Renewal stage updated");
  await expect(page.locator("ol li.font-semibold")).toHaveText("In review");

  await field(page, "stage").selectOption("remarketing");
  await field(page, "reason").fill("Rate increase over 15%");
  await page.getByRole("button", { name: "Update stage" }).click();
  await expectFlash(page, "Renewal stage updated");
  await expect(page.locator("ol li.font-semibold")).toHaveText("Remarketing");
  await expect(page.getByText("Note: Rate increase over 15%")).toBeVisible();
  await page.goto(`/policies/${id}?tab=activity`);
  await expect(page.getByRole("link", { name: /^Remarket / })).toBeVisible();

  await page.goto(`/policies/${id}?tab=renewal`);
  await field(page, "stage").selectOption("quoted");
  await page.getByRole("button", { name: "Update stage" }).click();
  await expectFlash(page, "Renewal stage updated");
  await expect(page.locator("ol li.font-semibold")).toHaveText("Quoted");
});

test("renew at +15%: a new term, flagged over the threshold; the old term closes out", async ({ as }) => {
  const id = need("renewPolicy");
  const before = Number(need("renewPremium"));
  const page = await as("mrivera");
  await page.goto(`/policies/${id}?tab=renewal`);
  const number = `UATREN-${T}-02`;
  await field(page, "policy_number").fill(number);
  await field(page, "premium").fill((before * 1.15).toFixed(2));
  await page.getByRole("button", { name: "Create renewal term" }).click();
  await expectFlash(page, "Renewal term created. Renewal tasks on the expiring term were closed.");
  const next = idFrom(page.url(), "policies");
  saveState({ renewedPolicy: next });
  await expect(page.getByRole("heading", { name: number })).toBeVisible();
  await expect(page.getByText("Over remarket threshold")).toBeVisible();
  await expect(page.getByText(/\+15\.0%/)).toBeVisible();
  await expect(page.getByRole("link", { name: need("renewNumber") }).first()).toBeVisible();

  await page.goto(`/policies/${next}`);
  await expect(summary(page, "Business")).toHaveText("Renewal");

  await page.goto(`/policies/${id}`);
  await expect(summary(page, "Renewed as")).toHaveText(number);
  await page.goto(`/policies/${id}?tab=renewal`);
  await expect(page.getByRole("link", { name: number })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create renewal term" }), "can't be renewed twice").toHaveCount(0);
  expect(val(`select count(*) from activities where policy_id = ${id} and code in ('REN-REVIEW','REN-PROC','REN-REMKT') and status in ('open','waiting')`), "renewal work is closed").toBe("0");
});

test("the renewal's follow-on work: a policy check, and a certificate reissue when certificates exist", async ({ as }) => {
  const next = need("renewedPolicy");
  const page = await as("mrivera");
  await page.goto(`/policies/${next}?tab=activity`);
  await expect(page.getByRole("link", { name: /^Policy check / })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Reissue \d+ certificate\(s\) for renewed / })).toBeVisible();
});

test("renew under the threshold: no flag", async ({ as }) => {
  const p = duePolicy(false, [need("renewPolicy")]);
  const page = await as("mrivera");
  await page.goto(`/policies/${p.id}?tab=renewal`);
  await field(page, "policy_number").fill(`UATREN-${T}-03`);
  await field(page, "premium").fill((p.premium * 1.02).toFixed(2));
  await page.getByRole("button", { name: "Create renewal term" }).click();
  await expectFlash(page, "Renewal term created.");
  await expect(page.getByText("Over remarket threshold")).toHaveCount(0);
  await expect(page.getByText(/\+2\.0%/)).toBeVisible();
});

test("a lost renewal leaves the pipeline, with its reason and its work closed", async ({ as }) => {
  const p = duePolicy(false, [need("renewPolicy")]);
  const page = await as("mrivera");
  await page.goto(`/policies/${p.id}?tab=renewal`);
  await field(page, "stage").selectOption("lost");
  await field(page, "reason").fill("Went with a direct writer");
  await page.getByRole("button", { name: "Update stage" }).click();
  await expectFlash(page, "Renewal stage updated");
  await page.goto("/renewals?days=120");
  await expect(page.locator(`a[href="/policies/${p.id}?tab=renewal"]`)).toHaveCount(0);
  expect(val(`select count(*) from activities where policy_id = ${p.id} and code in ('REN-REVIEW','REN-PROC','REN-REMKT') and status in ('open','waiting')`)).toBe("0");
});

test("a policy already in its second term can be worked and renewed from the pipeline", async ({ as }) => {
  // Every renewal term needs this a year later: the pipeline lists it and links to its Renewal tab.
  const id = val(`SELECT p.id FROM policies p WHERE p.status = 'active' AND p.prior_policy_id IS NOT NULL AND p.renewal_policy_id IS NULL AND p.renewal_stage NOT IN ('renewed','lost','non_renewed')
    AND coalesce(p.renewal_owner_id, p.account_manager_id) = ${MINE} AND p.expiration_date BETWEEN current_date AND current_date + 120 ORDER BY p.expiration_date LIMIT 1`);
  expect(id, "a seeded second-term policy expiring soon").not.toBe("");
  const page = await as("mrivera");
  await page.goto("/renewals?days=120");
  await page.locator(`a[href="/policies/${id}?tab=renewal"]`).click();
  await expect(page.getByRole("heading", { name: "Renew this policy" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Update stage" })).toBeVisible();
});
