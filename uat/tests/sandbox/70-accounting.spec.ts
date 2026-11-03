import { pickClient, test, expect, expectFlash, expectError, field, sql, val, saveState, need, T, todayISO, type Page } from "./fixtures";

// Accounting as Lisa Morgan. The invoices come from the agency-bill policy made in 40-policies.
const today = todayISO();
const month = today.slice(0, 7);
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kv = (page: Page, label: string | RegExp) => page.locator("dl > div").filter({ has: page.locator("dt", { hasText: label }) }).locator("dd");
const toNum = (s: string) => Number(s.replace(/[^0-9.-]/g, ""));

test("Accounting is there for accounting, read-only for an account manager, and hidden from a CSR", async ({ as }) => {
  const page = await as("lmorgan");
  await page.goto("/");
  await page.locator("aside").getByRole("link", { name: "Accounting" }).click();
  await expect(page.getByRole("heading", { name: "Accounting", exact: true })).toBeVisible();
  for (const tab of ["Receipts", "Invoices & aging", "Direct bill commissions", "Carrier payables", "Producer pay", "Trust account", "Ledger & export"]) await expect(page.locator("main nav").getByRole("link", { name: tab })).toBeVisible();
  const csr = await as("kowens");
  await csr.goto("/");
  await expect(csr.locator("aside").getByRole("link", { name: "Reports" })).toBeVisible();
  await expect(csr.locator("aside").getByRole("link", { name: "Accounting" })).toHaveCount(0);
  await csr.goto("/accounting");
  await expect(csr.getByText("Accounting is available to accounting, principal, admin and account manager roles.")).toBeVisible();
});

test("fee invoice", async ({ as }) => {
  const client = need("bizClient");
  const page = await as("lmorgan");
  await page.goto("/accounting/invoices");
  await pickClient(page, client);
  await field(page, "kind").selectOption("agency_fee");
  await field(page, "description").fill(`Service fee ${T}`);
  await field(page, "amount").fill("150");
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expectFlash(page, "Invoice created");
  const row = page.getByRole("row").filter({ hasText: `Service fee ${T}` });
  await expect(row.getByRole("cell", { name: "$150.00" }).first()).toBeVisible();
  await expect(row.getByText("open", { exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "PDF" })).toBeVisible();
  const pdf = await page.request.get((await row.getByRole("link", { name: "PDF" }).getAttribute("href"))!);
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  expect(sql(`select sum(credit) from ledger_entries where memo like 'Invoice %' and account = 'fee_income' and ref_id = (select id from invoices where memo = 'Service fee ${T}')`)[0][0]).toBe("150.00");
});

test("record a receipt: to trust, applied to the invoice, shown on the client", async ({ as }) => {
  const client = need("bizClient"), number = need("agencyPolicyNumber");
  const page = await as("lmorgan");
  const trustBefore = Number(val("select sum(debit - credit) from ledger_entries where account = 'trust_cash'"));
  await page.goto("/accounting/receipts");
  await page.getByRole("link", { name: "＋ Record payment" }).click();
  await pickClient(page, client);
  await page.getByRole("button", { name: "Load invoices" }).click();
  await expect(page).toHaveURL(new RegExp(`client=${client}`));
  const inv = page.getByRole("row").filter({ hasText: `New business ${number}` });
  await inv.getByRole("checkbox").check();
  await field(page, "amount").fill("12000");
  await field(page, "method").selectOption("check");
  await field(page, "reference").fill(`CK-${T}`);
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expectFlash(page, "Receipt of $12000.00 posted to trust and applied");
  await expect(page).toHaveURL(new RegExp(`/clients/${client}\\?tab=billing`));
  await expect(page.getByRole("row").filter({ hasText: `New business ${number}` }).getByText("paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: `CK-${T}` }).getByText("$12,000.00")).toBeVisible();
  expect(Number(val("select sum(debit - credit) from ledger_entries where account = 'trust_cash'")), "trust cash went up").toBeCloseTo(trustBefore + 12000, 2);
});

test("a part payment leaves the invoice partly paid; reversing it (NSF) reopens the invoice", async ({ as }) => {
  const client = need("bizClient");
  const page = await as("lmorgan");
  await page.goto(`/accounting/receipts/new?client=${client}`);
  const row = page.getByRole("row").filter({ hasText: `Service fee ${T}` });
  await row.getByRole("checkbox").check();
  await field(page, "amount").fill("50");
  await field(page, "reference").fill(`NSF-${T}`);
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expectFlash(page, "Receipt of $50.00 posted to trust and applied");
  const inv = page.getByRole("row").filter({ hasText: `Service fee ${T}` });
  await expect(inv.getByText("partial", { exact: true })).toBeVisible();
  await expect(inv.getByRole("cell", { name: "$100.00" })).toBeVisible();

  const trustBefore = Number(val("select sum(debit - credit) from ledger_entries where account = 'trust_cash'"));
  await page.goto("/accounting/receipts");
  const receipt = page.getByRole("row").filter({ hasText: `#NSF-${T}` });
  await receipt.getByText("NSF / reverse").click();
  await receipt.getByRole("button", { name: "Reverse" }).click();
  await expectFlash(page, "Receipt reversed; the invoices are open again");
  await expect(page.getByRole("row").filter({ hasText: `#NSF-${T}` }).getByText("reversed", { exact: true })).toBeVisible();
  await page.goto(`/clients/${client}?tab=billing`);
  const after = page.getByRole("row").filter({ hasText: `Service fee ${T}` });
  await expect(after.getByText("open", { exact: true })).toBeVisible();
  await expect(after.getByRole("cell", { name: "$150.00" }).first()).toBeVisible();
  expect(Number(val("select sum(debit - credit) from ledger_entries where account = 'trust_cash'")), "the money came back out of trust").toBeCloseTo(trustBefore - 50, 2);
});

test("client refund on a credit", async ({ as }) => {
  const credit = need("creditInvoice");
  const page = await as("lmorgan");
  await page.goto("/accounting/invoices?status=refunds");
  const row = page.getByRole("row").filter({ hasText: credit });
  await expect(row.getByRole("cell", { name: "-$300.00" }).first()).toBeVisible();
  await row.locator('input[name="reference"]').fill(`RF-${T}`);
  await row.getByRole("button", { name: "Refund" }).click();
  await expectFlash(page, "Refund paid from trust");
  await expect(page.getByRole("row").filter({ hasText: credit }), "it leaves Refunds due").toHaveCount(0);
  await page.goto("/accounting/invoices?status=paid");
  await expect(page.getByRole("row").filter({ hasText: credit }).getByText("paid", { exact: true })).toBeVisible();
  await page.goto("/accounting/receipts");
  await expect(page.getByRole("row").filter({ hasText: `#RF-${T}` }).getByText("-$300.00").first()).toBeVisible();
});

test("carrier payables: pay by statement; what was owed clears and shows as paid", async ({ as }) => {
  const page = await as("lmorgan");
  await page.goto("/accounting/payables");
  const carrier = "Piedmont Fire & Casualty";
  const row = page.getByRole("row").filter({ hasText: carrier }).first();
  await expect(row).toBeVisible();
  const owed = toNum(await row.locator("td").nth(3).innerText());
  // The agency-bill policy's premium was paid in full above: net of 15%, the carrier is owed at least 10,200.
  // The seed's own lines for this carrier count too, and its credits can make them net negative on any given day.
  const others = Number(val(`select coalesce(sum(il.payable_amount), 0) from invoice_lines il join invoices i on i.id = il.invoice_id join carriers ca on ca.id = il.carrier_id
    where ca.name = '${carrier}' and il.payable_to = 'carrier' and il.carrier_statement_id is null and (i.status = 'paid' or i.total < 0) and i.status <> 'void' and i.policy_id is distinct from ${need("agencyPolicy")}`));
  expect(owed).toBeGreaterThanOrEqual(10_200 - 300 * 0.85 + others - 0.01);
  await row.locator('input[name="reference"]').fill(`ACH-${T}`);
  await row.getByRole("button", { name: "Pay statement" }).click();
  await expectFlash(page, "Carrier statement paid from trust");
  await expect(page.locator("section").filter({ hasText: "Owed now" }).getByRole("row").filter({ hasText: carrier })).toHaveCount(0);
  const paid = page.locator("section").filter({ hasText: "Paid statements" }).getByRole("row").filter({ hasText: `ACH-${T}` });
  await expect(paid.getByText(money(owed))).toBeVisible();
});

function statementLines() {
  // Direct-bill policies of a producer with a split, all on one carrier.
  const rows = sql(`SELECT p.policy_number, p.premium, p.commission_pct, p.carrier_id, ca.name, c.name FROM policies p JOIN carriers ca ON ca.id = p.carrier_id JOIN clients c ON c.id = p.client_id
    WHERE p.status = 'active' AND p.bill_mode = 'direct' AND p.producer_id = (SELECT id FROM users WHERE username = 'rcallahan') AND p.new_renewal = 'renewal'
      AND p.carrier_id = (SELECT p2.carrier_id FROM policies p2 WHERE p2.status = 'active' AND p2.bill_mode = 'direct' AND p2.producer_id = (SELECT id FROM users WHERE username = 'rcallahan') AND p2.new_renewal = 'renewal' GROUP BY 1 HAVING count(*) >= 3 ORDER BY count(*) DESC LIMIT 1)
    ORDER BY p.id LIMIT 3`);
  expect(rows.length, "three seeded direct-bill policies on one carrier").toBe(3);
  return rows.map(([number, premium, pct, carrierId, carrier, insured]) => ({ number, premium: Number(premium), pct: Number(pct), carrierId, carrier, insured, expected: Math.round(Number(premium) * Number(pct)) / 100 }));
}

async function upload(page: Page, carrier: string, period: string, csv: string) {
  await page.goto("/accounting/commissions");
  await field(page, "carrier_id").selectOption({ label: carrier });
  await field(page, "period").fill(period);
  await field(page, "file").setInputFiles({ name: "statement.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Load and match" }).click();
}
const tile = (page: Page, label: string) => page.locator("div.rounded-lg").filter({ has: page.locator(`div.text-xs:text-is("${label}")`) }).locator("div.text-xl");
const lineRow = (page: Page, policy: string) => page.locator("tbody tr").filter({ hasText: policy });

test("commission statement: load a CSV, match, close, accept, refuse a wrong deposit, post", async ({ as }) => {
  const [a, b, c] = statementLines();
  const page = await as("lmorgan");
  // Past the tolerance (the greater of $1 and 1% of expected), so it reads as a variance whatever the policy's size.
  const over = Math.max(25, Math.ceil(b.expected * 0.02));
  const csv = ["Policy Number,Insured,Type,Premium,Rate,Commission",
    `${a.number},${a.insured.replace(/,/g, "")},Renewal,${a.premium},${a.pct},${a.expected}`,
    `${b.number},${b.insured.replace(/,/g, "")},Renewal,${b.premium},${b.pct},${(b.expected + over).toFixed(2)}`,
    `NOSUCH-${T},Mystery Insured,New,1000,10,100`,
    `TYPO-${T},Typo Insured,Renewal,${c.premium},${c.pct},${c.expected}`,
  ].join("\n");
  await upload(page, a.carrier, month, csv);
  await expectFlash(page, "4 lines loaded and matched to policies");
  await expect(tile(page, "Lines")).toHaveText("4");
  await expect(tile(page, "Matched")).toHaveText("1");
  await expect(tile(page, "Variance")).toHaveText("1");
  await expect(tile(page, "Unmatched")).toHaveText("2");
  const id = page.url().match(/commissions\/(\d+)/)![1];
  saveState({ statement: id, producerPolicy: a.number });

  // Posting with lines unresolved isn't offered (the server's own refusal is tested in ux-accounting-db.test.ts).
  await expect(page.getByRole("button", { name: "Resolve 3 lines to post" })).toBeDisabled();

  // Match the mistyped number to the real policy.
  await lineRow(page, `TYPO-${T}`).getByText("Resolve").click();
  await lineRow(page, `TYPO-${T}`).locator('input[name="policy_number"]').fill(c.number);
  await lineRow(page, `TYPO-${T}`).getByRole("button", { name: "Match" }).click();
  await expectFlash(page, "Updated");
  await expect(lineRow(page, c.number).getByText("matched", { exact: true })).toBeVisible();
  await expect(tile(page, "Unmatched")).toHaveText("1");

  // Close the one that isn't ours.
  await lineRow(page, `NOSUCH-${T}`).getByText("Resolve").click();
  await lineRow(page, `NOSUCH-${T}`).locator('input[name="note"]').fill("Not our policy, returned to carrier");
  await lineRow(page, `NOSUCH-${T}`).getByRole("button", { name: "Close" }).click();
  await expectFlash(page, "Updated");
  await expect(tile(page, "Closed")).toHaveText("1");
  await expect(lineRow(page, `NOSUCH-${T}`).getByText("Not our policy")).toBeVisible();

  // Accept the carrier's figure on the variance.
  await lineRow(page, b.number).getByText("Resolve").click();
  await lineRow(page, b.number).getByRole("button", { name: "Accept carrier amount" }).click();
  await expectFlash(page, "Updated");
  await expect(tile(page, "Variance")).toHaveText("0");
  await expect(lineRow(page, b.number).getByText("Variance accepted")).toBeVisible();

  // The deposit is recorded apart from posting, has to equal the lines, and a mismatch is refused with both numbers.
  const total = a.expected + b.expected + over + c.expected;
  await field(page, "deposit_amount").fill("1.00");
  await page.getByRole("button", { name: "Record the deposit" }).click();
  await expectFlash(page, "Deposit updated");
  await expect(page.getByRole("button", { name: "Fix the deposit to post" })).toBeDisabled();
  await expect(page.getByText(`Deposit doesn't equal lines ${money(total)}`)).toBeVisible();
  expect(val(`select status from commission_statements where id = ${id}`)).toBe("draft");

  await field(page, "deposit_amount").fill(total.toFixed(2));
  await page.getByRole("button", { name: "Correct the deposit" }).click();
  await expectFlash(page, "Deposit updated");
  const income = Number(val("select sum(credit - debit) from ledger_entries where account = 'commission_income'"));
  await page.getByRole("button", { name: "Post to commission income" }).click();
  await expectFlash(page, "Statement posted: commission income recorded");
  await expect(page.getByText("posted", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Post to commission income" })).toHaveCount(0);
  expect(Number(val("select sum(credit - debit) from ledger_entries where account = 'commission_income'"))).toBeCloseTo(income + total, 2);
});

test("adding a line by hand; a statement with no file is entered by hand", async ({ as }) => {
  const [a] = statementLines();
  const page = await as("lmorgan");
  await page.goto("/accounting/commissions");
  await field(page, "carrier_id").selectOption({ label: a.carrier });
  await field(page, "period").fill(`${month}`);
  await page.getByRole("button", { name: "Load and match" }).click();
  await expectFlash(page, "Statement created — add lines below");
  await field(page, "policy_number").fill(a.number);
  await field(page, "premium").fill(String(a.premium));
  await field(page, "commission").fill(String(a.expected));
  await field(page, "rate_pct").fill(String(a.pct));
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expectFlash(page, "Line added");
  await expect(lineRow(page, a.number).getByText("matched", { exact: true })).toBeVisible();
  await expect(tile(page, "Lines")).toHaveText("1");
  saveState({ manualStatement: page.url().match(/commissions\/(\d+)/)![1] });
});

test("re-running the match leaves lines already resolved alone", async ({ as }) => {
  const [, b] = statementLines();
  const page = await as("lmorgan");
  await upload(page, b.carrier, month, `Policy,Insured,Type,Premium,Rate,Commission\n${b.number},X,Renewal,${b.premium},${b.pct},${(b.expected + 40).toFixed(2)}\n`);
  await expectFlash(page, "1 lines loaded");
  await lineRow(page, b.number).getByText("Resolve").click();
  await lineRow(page, b.number).getByRole("button", { name: "Accept carrier amount" }).click();
  await expectFlash(page, "Updated");
  await expect(tile(page, "Variance")).toHaveText("0");
  const statement = page.url().match(/commissions\/(\d+)/)![1];
  await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), page.getByRole("button", { name: "Re-run matching" }).click()]);
  await page.goto(`/accounting/commissions/${statement}`);
  await expect(tile(page, "Lines")).toHaveText("1");
  await expect(tile(page, "Variance"), "the accepted variance stays accepted").toHaveText("0");
});

test("a CSV with no usable columns is refused; a PDF says it needs Claude", async ({ as }) => {
  const page = await as("lmorgan");
  const carrier = statementLines()[0].carrier;
  await upload(page, carrier, month, "foo,bar\n1,2\n");
  await expectError(page, "No lines found. The CSV needs columns for policy number, premium and commission.");
  await page.goto("/accounting/commissions");
  await field(page, "carrier_id").selectOption({ label: carrier });
  await field(page, "file").setInputFiles({ name: "statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n") });
  await page.getByRole("button", { name: "Load and match" }).click();
  await expectError(page, "Reading a PDF statement needs ANTHROPIC_API_KEY");
});

test("producer statement: build for the period and pay; lines add up to the split", async ({ as }) => {
  const page = await as("lmorgan");
  need("statement");
  await page.goto("/accounting/producers");
  await field(page, "period").fill(month);
  await page.getByRole("button", { name: "Build" }).click();
  await expectFlash(page, new RegExp(`\\d+ producer statement\\(s\\) built for ${month}`));
  const row = page.getByRole("row").filter({ hasText: "Ryan Callahan" }).filter({ hasText: month });
  await expect(row.getByText("draft", { exact: true })).toBeVisible();
  const total = toNum(await row.locator("td").nth(5).innerText());
  expect(total, "Ryan has commission on the statement posted above").toBeGreaterThan(0);
  await row.getByRole("link", { name: "Ryan Callahan" }).click();
  await expect(page).toHaveURL(/\?id=\d+/);
  const lines = page.locator("section").filter({ hasText: "Statement lines" }).locator("tbody tr");
  expect(await lines.count()).toBeGreaterThan(0);
  const opBefore = Number(val("select sum(debit - credit) from ledger_entries where account = 'operating_cash'"));
  await page.getByRole("row").filter({ hasText: "Ryan Callahan" }).filter({ hasText: month }).getByRole("button", { name: "Pay" }).click();
  await expectFlash(page, "Producer statement paid");
  await expect(page.getByRole("row").filter({ hasText: "Ryan Callahan" }).filter({ hasText: month }).getByText("paid", { exact: true })).toBeVisible();
  expect(Number(val("select sum(debit - credit) from ledger_entries where account = 'operating_cash'"))).toBeCloseTo(opBefore - total, 2);
});

test("trust sweep: more than the excess is refused, the excess goes through", async ({ as }) => {
  const page = await as("lmorgan");
  await page.goto("/accounting/trust");
  await expect(page.getByRole("heading", { name: "Premium trust account" })).toBeVisible();
  await expect(page.getByText(/Shortfall of/), "trust covers its obligations").toHaveCount(0);
  const available = toNum(await field(page, "amount").inputValue());
  expect(available, "the seeded book has earned commission to sweep").toBeGreaterThan(1);
  await field(page, "amount").fill((available + 100).toFixed(2));
  await page.getByRole("button", { name: "Sweep" }).click();
  await expectError(page, `Only ${available.toFixed(2)} can be swept: the rest is owed to carriers, states and clients.`);
  await field(page, "amount").fill("1.00");
  await page.getByRole("button", { name: "Sweep" }).click();
  await expectFlash(page, "Commission swept to operating");
  await expect(page.getByText("Earned commission sweep, trust to operating").first()).toBeVisible();
  const left = toNum(await field(page, "amount").inputValue());
  expect(left).toBeCloseTo(available - 1, 2);
});

test("period lock: a locked month refuses postings with a reason; unlocking lets them through", async ({ as }) => {
  const client = need("bizClient");
  const page = await as("lmorgan");
  const lockRow = () => page.locator("section").filter({ hasText: "Accounting periods" }).getByRole("row").filter({ hasText: month });
  await page.goto("/accounting/ledger");
  await lockRow().getByRole("button", { name: "Lock" }).click();
  await expectFlash(page, `${month} locked`);
  await expect(lockRow().getByText("locked", { exact: true })).toBeVisible();
  try {
    await page.goto("/accounting/invoices");
    await pickClient(page, client);
    await field(page, "description").fill(`Locked fee ${T}`);
    await field(page, "amount").fill("10");
    await page.getByRole("button", { name: "Create invoice" }).click();
    await expectError(page, `Accounting period ${month} is locked.`);
    expect(val(`select count(*) from invoices where memo = 'Locked fee ${T}'`)).toBe("0");

    await page.goto(`/accounting/receipts/new?client=${client}`);
    await field(page, "amount").fill("5");
    await page.getByRole("button", { name: "Post receipt" }).click();
    await expectError(page, `Accounting period ${month} is locked.`);
  } finally {
    await page.goto("/accounting/ledger");
    await lockRow().getByRole("button", { name: "Unlock" }).click();
    await expectFlash(page, `${month} unlocked`);
  }
  // A month the seed already locked stays refused for a backdated receipt.
  const old = val("select period from accounting_periods where locked order by period limit 1");
  await page.goto(`/accounting/receipts/new?client=${client}`);
  await field(page, "amount").fill("5");
  await field(page, "date").fill(`${old}-15`);
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expectError(page, `Accounting period ${old} is locked.`);
});

test("an account manager endorsing into a locked month gets told why", async ({ as }) => {
  const policy = need("agencyPolicy");
  const acct = await as("lmorgan");
  const lockRow = () => acct.locator("section").filter({ hasText: "Accounting periods" }).getByRole("row").filter({ hasText: month });
  await acct.goto("/accounting/ledger");
  await lockRow().getByRole("button", { name: "Lock" }).click();
  await expectFlash(acct, `${month} locked`);
  try {
    const page = await as("mrivera");
    await page.goto(`/policies/${policy}?action=endorse`);
    await field(page, "description").fill("Into a locked month");
    await field(page, "premium_change").fill("10");
    await page.getByRole("button", { name: "Record endorsement" }).click();
    await expect(page.locator('[role="alert"]').filter({ hasText: `Accounting period ${month} is locked.` }).first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await acct.goto("/accounting/ledger");
    await lockRow().getByRole("button", { name: "Unlock" }).click();
    await expectFlash(acct, `${month} unlocked`);
  }
});

test("GL exports: CSV summary and detail, QuickBooks IIF, and the trust statement", async ({ as }) => {
  const page = await as("lmorgan");
  await page.goto(`/accounting/ledger?month=${month}`);
  await expect(page.getByRole("heading", { name: `Summary · ${month}` })).toBeVisible();
  const get = async (name: string) => {
    const res = await page.request.get((await page.getByRole("link", { name }).getAttribute("href"))!);
    expect(res.status(), name).toBe(200);
    return { type: res.headers()["content-type"], disposition: res.headers()["content-disposition"], text: await res.text() };
  };
  const summary = await get("Summary journal (CSV)");
  expect(summary.type).toContain("text/csv");
  expect(summary.disposition).toContain(`ams-journal-summary-${month}.csv`);
  const rows = summary.text.trim().split("\n");
  expect(rows[0]).toBe("date,gl_account,debit,credit,memo");
  const sumCol = (i: number) => rows.slice(1).reduce((s, r) => s + Number(r.split(",")[i]), 0);
  expect(sumCol(2), "the summary journal balances").toBeCloseTo(sumCol(3), 2);
  expect(rows.some((r) => r.includes("1010 Premium Trust Cash"))).toBe(true);

  const detail = await get("Detail (CSV)");
  expect(detail.type).toContain("text/csv");
  expect(detail.text.split("\n")[0]).toBe("date,journal,gl_account,account,debit,credit,memo,source,source_id");
  expect(detail.text.split("\n").length).toBeGreaterThan(3);

  const iif = await get("QuickBooks IIF");
  expect(iif.disposition).toContain(`ams-journal-${month}.iif`);
  const lines = iif.text.trim().split("\n");
  expect(lines[0].startsWith("!TRNS")).toBe(true);
  expect(lines.at(-1)).toBe("ENDTRNS");
  const amounts = lines.filter((l) => /^(TRNS|SPL)\t/.test(l)).map((l) => Number(l.split("\t")[4]));
  expect(amounts.length).toBeGreaterThan(1);
  expect(amounts.reduce((s, n) => s + n, 0), "the IIF transaction nets to zero").toBeCloseTo(0, 2);

  await page.goto("/accounting/trust");
  const trust = await get("Download statement (CSV)");
  expect(trust.type).toContain("text/csv");
  expect(trust.text).toContain("Statement of premium trust");
  expect(trust.text).toContain("Excess available");
  const unstamped = () => Number(val(`select count(*) from ledger_entries where to_char(entry_date, 'YYYY-MM') = '${month}' and exported_batch is null`));
  expect(unstamped(), "downloading changes nothing").toBeGreaterThan(0);
  await page.goto(`/accounting/ledger?month=${month}`);
  await page.getByRole("button", { name: "Mark as exported" }).click();
  await expectFlash(page, `${month} marked as exported`);
  expect(unstamped(), "the button marks the month").toBe(0);
});

test("a client credit: an overpayment makes one, it can be applied to an invoice, and applying can be undone", async ({ as }) => {
  const row = sql(`SELECT i.client_id FROM invoices i WHERE i.status = 'open' AND i.total > 100 AND NOT EXISTS (SELECT 1 FROM invoices o WHERE o.client_id = i.client_id AND o.total < 0 AND o.status = 'open')
    GROUP BY i.client_id HAVING count(*) >= 2 ORDER BY i.client_id DESC LIMIT 1`)[0];
  test.skip(!row, "no client with two open invoices");
  const clientId = row[0];
  const [first, second] = sql(`SELECT id, total FROM invoices WHERE client_id = ${clientId} AND status = 'open' AND total > 100 ORDER BY id LIMIT 2`);
  const bal = (id: string) => Number(val(`select i.total - coalesce((select sum(ra.amount) from receipt_applications ra join receipts r on r.id = ra.receipt_id where ra.invoice_id = i.id and r.status = 'finalized'), 0) from invoices i where i.id = ${id}`));
  const secondBefore = bal(second[0]);
  const page = await as("lmorgan");

  // Overpay the first invoice by $50. The amount starts empty; the balance it offers is what's owed, never netted against credits.
  await page.goto(`/accounting/receipts/new?client=${clientId}`);
  const owed = sql(`SELECT id FROM invoices WHERE client_id = ${clientId} AND status IN ('open','partial') AND total > 0`).reduce((s, [id]) => s + bal(id), 0);
  await expect(field(page, "amount")).toHaveValue("");
  await expect(page.getByText(`Open balance ${money(owed)}`)).toBeVisible();
  await page.locator(`input[name="invoice_ids"][value="${first[0]}"]`).check();
  await field(page, "amount").fill((bal(first[0]) + 50).toFixed(2));
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expect.poll(() => val(`select id from invoices where client_id = ${clientId} and total = -50 and status = 'open' order by id desc limit 1`)).not.toBe("");

  // The credit is pointed out on the payment form, and isn't past due.
  await page.goto(`/accounting/receipts/new?client=${clientId}`);
  await expect(page.getByText(/This client has \$50(\.00)? of credit/)).toBeVisible();

  await page.goto(`/clients/${clientId}?tab=billing`);
  await page.locator('select[name="invoice_id"]').selectOption(second[0]);
  await page.locator('form:has(select[name="credit_id"]) input[name="amount"]').fill("20");
  await page.getByRole("button", { name: "Apply credit" }).click();
  await expectFlash(page, "Credit applied");
  expect(bal(second[0])).toBeCloseTo(secondBefore - 20, 2);

  await page.locator('form:has(select[name="credit_id"]) input[name="amount"]').fill("31");
  await page.getByRole("button", { name: "Apply credit" }).click();
  await expectError(page, "Only 30.00 of this credit is left.");

  // Undo it from the receipts list: both go back.
  await page.goto("/accounting/receipts");
  const receipt = page.locator("tbody tr").filter({ hasText: "CAPP-" }).first();
  await receipt.getByText("Undo credit").click();
  await receipt.getByRole("button", { name: "Reverse" }).click();
  await expect.poll(() => bal(second[0])).toBeCloseTo(secondBefore, 2);

  // Leave the books tidy for what follows: blank applies everything that's left.
  await page.goto(`/clients/${clientId}?tab=billing`);
  await page.locator('select[name="invoice_id"]').selectOption(second[0]);
  await page.getByRole("button", { name: "Apply credit" }).click();
  await expectFlash(page, "Credit applied");
  expect(bal(second[0])).toBeCloseTo(secondBefore - 50, 2);
});

test("the receivables pages work: aging, past due, and the overview tiles", async ({ as }) => {
  const page = await as("lmorgan");
  await page.goto("/accounting");
  await expect(page.getByRole("heading", { name: "Receivables aging" })).toBeVisible();
  await expect(page.getByText("Commission income YTD")).toBeVisible();
  await page.goto("/accounting/invoices?status=pastdue");
  await expect(page.getByRole("heading", { name: "Invoices & aging" })).toBeVisible();
  await page.goto("/accounting/invoices?status=all");
  await expect(page.locator("tbody tr").first()).toBeVisible();
});

test.describe("an account manager can see accounting but not post", () => {
  test("no posting controls, and the payment page says no", async ({ as }) => {
    const page = await as("mrivera");
    await page.goto("/accounting/receipts");
    await expect(page.getByRole("heading", { name: "Receipts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "＋ Record payment" })).toHaveCount(0);
    await expect(page.getByText("NSF / reverse")).toHaveCount(0);
    await page.goto("/accounting/receipts/new");
    await expect(page.getByText("You can't open payment entry")).toBeVisible();
    await expect(page.getByRole("button", { name: "Post receipt" })).toHaveCount(0);
    await page.goto("/accounting/invoices");
    await expect(page.getByRole("button", { name: "Create invoice" })).toHaveCount(0);
    await page.goto("/accounting/payables");
    await expect(page.getByRole("button", { name: "Pay statement" })).toHaveCount(0);
    await page.goto("/accounting/commissions");
    await expect(page.getByRole("button", { name: "Load and match" })).toHaveCount(0);
    await page.goto("/accounting/producers");
    await expect(page.getByRole("button", { name: "Build" })).toHaveCount(0);
    await page.goto("/accounting/trust");
    await expect(page.getByRole("button", { name: "Sweep" })).toHaveCount(0);
    await page.goto("/accounting/ledger");
    await expect(page.getByRole("button", { name: "Lock" })).toHaveCount(0);
    await page.goto(`/clients/${need("bizClient")}?tab=billing`);
    await expect(page.getByRole("link", { name: "Record payment" })).toHaveCount(0);
  });

  test("the server refuses it too: a captured posting form replayed by an account manager writes nothing", async ({ as, apiAs, baseURL }) => {
    // Lisa Morgan's page holds the receipt form's action id; Marisol Rivera sends it straight to the server.
    const client = need("bizClient");
    const acct = await as("lmorgan");
    await acct.goto(`/accounting/receipts/new?client=${client}`);
    const actionField = await acct.locator('form:has(button:text-is("Post receipt")) input[name^="$ACTION_ID_"]').getAttribute("name");
    expect(actionField).toBeTruthy();
    const am = await apiAs("mrivera");
    const before = val("select count(*) from receipts");
    const res = await am.post(`/accounting/receipts/new?client=${client}`, {
      headers: { Origin: new URL(baseURL!).origin, Accept: "text/html" },
      multipart: { [actionField!]: "", client_id: client, amount: "99", method: "check", reference: `HACK-${T}`, date: today },
      maxRedirects: 0,
    });
    expect(val("select count(*) from receipts"), "no receipt was posted").toBe(before);
    expect(res.status(), "not a success").toBeGreaterThanOrEqual(300);
  });
});
