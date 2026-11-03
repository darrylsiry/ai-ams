import { pickClient, test, expect, expectFlash, expectError, field, newTask, addDays, todayISO, val, tag, type Page } from "./fixtures";

// My Day and the task focus view, as an account manager and a principal.
const today = todayISO();
const nice = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "medium" });
const queueRow = (page: Page, subject: string) => page.locator("section").filter({ has: page.getByRole("heading", { name: "Priority queue" }) }).locator("li").filter({ hasText: subject });

test("new task from the My Day page: it lands in the right bucket with its reason chip", async ({ as }) => {
  const page = await as("mrivera");
  const t = tag();
  await page.goto("/");
  await page.getByRole("link", { name: "＋ Task" }).click();
  await expect(page.getByRole("heading", { name: "New task" })).toBeVisible();
  const todayTask = `UAT due today ${t}`;
  const urgent = `UAT urgent later ${t}`;
  const later = `UAT due later ${t}`;
  await newTask(page, todayTask, { due: today });
  await newTask(page, urgent, { due: addDays(today, 5), priority: "urgent" });
  await newTask(page, later, { due: addDays(today, 5) });

  await page.goto("/?view=mine");
  const doNow = page.locator("section div").filter({ hasText: /^Do now/ }).first().locator("xpath=..");
  await expect(doNow.locator("li").filter({ hasText: urgent }), "urgent work is in Do now, whatever its date").toBeVisible();
  await expect(doNow.locator("li").filter({ hasText: urgent }).getByText("Urgent", { exact: true })).toBeVisible();
  const todayGroup = page.locator("section div").filter({ hasText: /^Today/ }).first().locator("xpath=..");
  await expect(todayGroup.locator("li").filter({ hasText: todayTask })).toBeVisible();
  await expect(todayGroup.locator("li").filter({ hasText: todayTask }).getByText("Due today", { exact: true })).toBeVisible();
  await expect(queueRow(page, later), "later work stays folded away").toHaveCount(0);
  await page.getByRole("link", { name: /Show \d+ upcoming tasks? →/ }).click();
  const coming = page.locator("section div").filter({ hasText: /^Coming up/ }).first().locator("xpath=..");
  // The group is ranked and paged, so a low-ranked task may be on a later page of it.
  const row = coming.locator("li").filter({ hasText: later });
  await expect(coming.locator("li").first()).toBeVisible();
  const pager = coming.getByRole("navigation", { name: "Coming up pages" });
  for (let n = 2; n < 22 && !(await row.count()); n++) {
    const next = pager.getByRole("link", { name: "Next" });
    if (!(await next.count())) break;
    await next.click();
    await expect(pager.getByText(`Page ${n} of`)).toBeVisible();
  }
  await expect(row).toBeVisible();
});

test("the queue is ranked: scores fall within each bucket and the bucket counts match", async ({ as }) => {
  const page = await as("mrivera");
  await page.goto("/?show=all&view=mine");
  await expect(page.getByRole("heading", { name: "Priority queue" })).toBeVisible();
  const groups = await page.$$eval("section ul", (uls) => uls.map((ul) => [...ul.querySelectorAll('span[title^="Priority score"]')].map((s) => Number(s.textContent))).filter((g) => g.length));
  expect(groups.length).toBeGreaterThan(0);
  for (const g of groups) expect(g, "highest score first").toEqual([...g].sort((a, b) => b - a));
  // Every queued line says why it ranks where it does.
  const chips = page.locator('section li:has(span[title^="Priority score"])').first().locator("span.rounded-full");
  expect(await chips.count(), "reason chips on the top task").toBeGreaterThan(0);
  await expect(page.getByText("Do now").first()).toBeVisible();
  await expect(page.getByText("urgent or overdue")).toBeVisible();
});

test("Start next task opens the top-scoring task in focus view", async ({ as }) => {
  const page = await as("mrivera");
  await page.goto("/?show=all&view=mine");
  const scores = await page.$$eval('section li span[title^="Priority score"]', (ss) => ss.map((s) => Number(s.textContent)));
  const top = Math.max(...scores);
  await page.getByRole("link", { name: "Start next task" }).click();
  await expect(page).toHaveURL(/\/tasks\/\d+\?focus=1/);
  await expect(page.getByText("Focus mode · your top task")).toBeVisible();
  await expect(page.getByText(`score ${top}`, { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish this task" })).toBeVisible();
});

test("the header's Next task and the n and / keys", async ({ as }) => {
  const page = await as("mrivera");
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("/");
  await expect(page.locator("#global-search")).toBeFocused();
  await page.locator("#global-search").blur();
  await page.keyboard.press("n");
  await expect(page).toHaveURL(/\/tasks\/\d+\?focus=1/);
  await page.goto("/clients");
  await page.getByRole("link", { name: "Next task →" }).first().click();
  await expect(page).toHaveURL(/\/tasks\/\d+\?focus=1/);
});

test("team priorities: a principal can switch views; an account manager has no such switch", async ({ as }) => {
  const am = await as("mrivera");
  await am.goto("/");
  await expect(am.getByRole("heading", { name: "Priority queue" })).toBeVisible();
  await expect(am.getByRole("link", { name: "Team priorities" })).toHaveCount(0);
  await expect(am.getByRole("heading", { name: "Team workload" })).toHaveCount(0);
  const page = await as("choll");
  await page.goto("/?view=mine");
  await expect(page.getByRole("heading", { name: "Priority queue" })).toBeVisible();
  await page.getByRole("link", { name: "Team priorities" }).click();
  await expect(page.getByRole("heading", { name: "Team priorities" })).toBeVisible();
  const list = page.locator("section").filter({ has: page.getByRole("heading", { name: "Team priorities" }) });
  await expect(list.locator("li").first()).toBeVisible();
  // The team view names who owns each task.
  await expect(list.getByText(/Marisol Rivera|Jordan Brooks|Anika Patel|Thomas Nguyen/).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Team workload" })).toBeVisible();
  await page.getByRole("link", { name: /My queue \(\d+\)/ }).click();
  await expect(page.getByRole("heading", { name: "Priority queue" })).toBeVisible();
});

test("complete: quick Done on My Day, with the count going up", async ({ as }) => {
  const page = await as("mrivera");
  const subject = `UAT quick done ${tag()}`;
  await newTask(page, subject, { due: today });
  await page.goto("/?view=mine");
  const tile = page.locator("div.rounded-lg").filter({ hasText: /^Done today/ }).locator("div.text-2xl");
  const done = (await tile.textContent()) ?? "0";
  await queueRow(page, subject).getByRole("button", { name: "✓ Done" }).click();
  await expectFlash(page, `Completed “${subject}”`);
  await expect(queueRow(page, subject)).toHaveCount(0);
  await expect(tile).toHaveText(String(Number(done) + 1));
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(queueRow(page, subject), "Undo puts it back in the queue").toBeVisible();
  await expect(tile).toHaveText(done);
});

test("complete in focus view with an outcome and a follow-up", async ({ as }) => {
  const page = await as("mrivera");
  const subject = `UAT outcome ${tag()}`;
  const id = await newTask(page, subject, { due: today });
  await page.goto(`/tasks/${id}`);
  await field(page, "outcome").fill("Spoke with the insured, all sorted");
  await field(page, "follow_up_days").selectOption("3");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expectFlash(page, `Done — follow-up set for ${nice(addDays(today, 3))}`);
  await expect(page.getByText(/Completed .* by Marisol Rivera — Spoke with the insured/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish this task" }), "a finished task offers no more actions").toHaveCount(0);
  await page.goto(`/tasks?q=${encodeURIComponent(subject)}`);
  await expect(page.getByRole("link", { name: `Follow up: ${subject}` })).toBeVisible();
});

test("Done & next goes straight to the next task", async ({ as }) => {
  const page = await as("mrivera");
  const subject = `UAT done next ${tag()}`;
  const id = await newTask(page, subject, { due: today });
  await page.goto(`/tasks/${id}`);
  await page.getByRole("button", { name: "Done & next →" }).click();
  await expectFlash(page, "Done. Here's your next task.");
  await expect(page.getByText("Focus mode · your top task")).toBeVisible();
  await expect(page.getByRole("heading", { name: subject }), "it moved on from the finished task").toHaveCount(0);
});

test("snooze: from My Day and from focus view; the task leaves the queue and says when it's back", async ({ as }) => {
  const page = await as("mrivera");
  const subject = `UAT snooze ${tag()}`;
  const id = await newTask(page, subject, { due: today });
  await page.goto("/?view=mine");
  const row = queueRow(page, subject);
  await row.locator("summary").click();
  await row.getByRole("button", { name: "Tomorrow" }).click();
  await expectFlash(page, `Snoozed until ${nice(addDays(today, 1))}`);
  await expect(queueRow(page, subject)).toHaveCount(0);
  await expect(page.locator("section").filter({ hasText: /^Snoozed/ }).getByRole("link", { name: subject }), "it has somewhere to live").toBeVisible();
  await page.goto(`/tasks/${id}`);
  await expect(page.getByText(`snoozed to ${nice(addDays(today, 1))}`)).toBeVisible();
  await page.getByRole("button", { name: "3 days" }).click();
  await expectFlash(page, `Snoozed to ${nice(addDays(today, 3))}`);
  await expect(page.getByText("Focus mode · your top task")).toBeVisible();
});

test("Wait & next parks the task and goes straight to the next one", async ({ as }) => {
  const page = await as("mrivera");
  const subject = `UAT wait next ${tag()}`;
  const id = await newTask(page, subject, { due: today });
  await page.goto(`/tasks/${id}`);
  await page.getByRole("button", { name: "Wait & next →" }).click();
  await expect(page.getByText("Focus mode · your top task")).toBeVisible();
  await expect(page.getByRole("heading", { name: subject })).toHaveCount(0);
});

test("wait on someone, see it parked, then resume it", async ({ as }) => {
  const page = await as("mrivera");
  const subject = `UAT waiting ${tag()}`;
  const id = await newTask(page, subject, { due: today });
  await page.goto(`/tasks/${id}`);
  await field(page, "waiting_on").selectOption("carrier");
  await field(page, "follow_up_date").fill(addDays(today, 4));
  await field(page, "comment").fill("Loss runs from the carrier");
  await page.getByRole("button", { name: "Wait", exact: true }).click();
  await expectFlash(page, `Waiting on carrier — back in your queue ${nice(addDays(today, 4))}`);
  await expect(page.getByText(`waiting on carrier, back ${nice(addDays(today, 4))}`)).toBeVisible();
  await expect(page.getByText(/Waiting on carrier — follow up .*Loss runs from the carrier/)).toBeVisible();
  await page.goto("/tasks?view=mine&status=waiting&q=" + encodeURIComponent(subject));
  await expect(page.getByRole("link", { name: subject })).toBeVisible();
  await page.goto("/?view=mine");
  await expect(queueRow(page, subject), "parked until its date").toHaveCount(0);
  await page.goto(`/tasks/${id}`);
  await page.getByRole("button", { name: "It arrived — back to my queue" }).click();
  await expectFlash(page, "Back in your queue");
  await expect(page.getByText(`waiting on carrier, back`)).toHaveCount(0);
  await page.goto("/?view=mine");
  await expect(queueRow(page, subject)).toBeVisible();
});

test("a waiting task comes back as a chase item on its follow-up date", async ({ as }) => {
  const page = await as("mrivera");
  const subject = `UAT chase ${tag()}`;
  const id = await newTask(page, subject, { due: today });
  await page.goto(`/tasks/${id}`);
  await field(page, "waiting_on").selectOption("client");
  await field(page, "follow_up_date").fill(today);
  await page.getByRole("button", { name: "Wait", exact: true }).click();
  await expectFlash(page, "Waiting on client");
  await page.goto("/?view=mine");
  const row = queueRow(page, subject);
  await expect(row.getByText("Chase client")).toBeVisible();
  await expect(row.getByText("chase today")).toBeVisible();
});

test("waiting with no date uses the follow-up days set for who you're waiting on", async ({ as }) => {
  const page = await as("mrivera");
  const id = await newTask(page, `UAT wait default ${tag()}`, { due: today });
  await page.goto(`/tasks/${id}`);
  await expect(field(page, "follow_up_date")).toHaveValue("");
  await field(page, "waiting_on").selectOption("carrier");
  await page.getByRole("button", { name: "Wait", exact: true }).click();
  await expectFlash(page, `Waiting on carrier — back in your queue ${nice(addDays(today, 5))}`);
});

test("reassign, reprioritize and cancel from the task", async ({ as }) => {
  const page = await as("mrivera");
  const subject = `UAT reassign ${tag()}`;
  const id = await newTask(page, subject, { due: today });
  await page.goto(`/tasks/${id}`);
  await page.getByText("Reassign, reprioritize, cancel").click();
  await page.locator("form", { has: page.getByRole("button", { name: "Reassign" }) }).locator('[name="owner_id"]').selectOption({ label: "Kayla Owens" });
  await page.getByRole("button", { name: "Reassign" }).click();
  await expectFlash(page, "Reassigned");
  await expect(page.getByText("· Kayla Owens")).toBeVisible();
  await expect(page.getByText("Reassigned to Kayla Owens")).toBeVisible();
  const csr = await as("kowens");
  await csr.goto(`/tasks?q=${encodeURIComponent(subject)}`);
  await expect(csr.getByRole("link", { name: subject }), "it's on the new owner's list").toBeVisible();

  // It's Kayla's now: Marisol can see it, not change it. A principal can.
  await page.goto(`/tasks/${id}`);
  await expect(page.getByText("This is Kayla Owens's task. Ask them, or a principal, to change it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);

  const principal = await as("choll");
  await principal.goto(`/tasks/${id}`);
  await principal.getByText("Reassign, reprioritize, cancel").click();
  await field(principal, "priority").selectOption("urgent");
  await field(principal, "due_date").fill(addDays(today, 2));
  await principal.locator("form", { has: field(principal, "priority") }).getByRole("button", { name: "Save" }).click();
  await expectFlash(principal, "Task updated");
  await expect(principal.getByText("Urgent").first()).toBeVisible();

  await principal.goto(`/tasks/${id}`);
  await principal.getByText("Reassign, reprioritize, cancel").click();
  await field(principal, "reason").fill("Client withdrew the request");
  await principal.getByRole("button", { name: "Cancel task" }).click();
  await expectFlash(principal, "Task cancelled");
  await expect(principal.getByText(/Cancelled .*Client withdrew the request/)).toBeVisible();
});

test("add a note; an empty note is refused", async ({ as }) => {
  const page = await as("mrivera");
  const id = await newTask(page, `UAT note ${tag()}`, { due: today });
  await page.goto(`/tasks/${id}`);
  await page.getByRole("button", { name: "Add note" }).click();
  await expectError(page, "Write something first.");
  await field(page, "body").fill("Called the insured about the renewal");
  await field(page, "kind").selectOption("call");
  await field(page, "confidential").check();
  await page.getByRole("button", { name: "Add note" }).click();
  await expectFlash(page, "Note added");
  const notes = page.locator("section").filter({ has: page.getByRole("heading", { name: /Notes and history · 1/ }) });
  await expect(notes.getByText("Called the insured about the renewal")).toBeVisible();
  await expect(notes.getByText("call", { exact: true })).toBeVisible();
  await expect(notes.getByText("confidential", { exact: true })).toBeVisible();
});

test("checklist items toggle, and the count follows", async ({ as }) => {
  const page = await as("mrivera");
  const code = val("select code from activity_codes where array_length(checklist, 1) >= 2 and active order by code limit 1");
  const n = Number(val(`select array_length(checklist, 1) from activity_codes where code = '${code}'`));
  const id = await newTask(page, `UAT checklist ${tag()}`, { code, due: today });
  await page.goto(`/tasks/${id}`);
  await expect(page.getByRole("heading", { name: `Checklist · 0/${n}` })).toBeVisible();
  await page.getByRole("button", { name: /^Mark “.*” done$/ }).first().click();
  await expect(page.getByRole("heading", { name: `Checklist · 1/${n}` })).toBeVisible();
  await page.getByRole("button", { name: /^Mark “.*” not done$/ }).first().click();
  await expect(page.getByRole("heading", { name: `Checklist · 0/${n}` })).toBeVisible();
});

test("a task on a client, with a policy, shows on that client", async ({ as }) => {
  const page = await as("mrivera");
  const [client] = [val("select c.id from clients c join policies p on p.client_id = c.id and p.status = 'active' where c.account_manager_id = (select id from users where username = 'mrivera') order by c.id limit 1")];
  const subject = `UAT on client ${tag()}`;
  await page.goto("/tasks/new");
  await pickClient(page, client);
  await page.getByRole("button", { name: "Load policies" }).click();
  await expect(page).toHaveURL(new RegExp(`client=${client}`));
  await field(page, "subject").fill(subject);
  const policy = page.locator('select[name="policy_id"] option:not([value=""])').first();
  await field(page, "policy_id").selectOption((await policy.getAttribute("value"))!);
  await page.getByRole("button", { name: "Create task" }).click();
  await expectFlash(page, "Task created");
  await expect(page.getByRole("link", { name: "Open account" })).toBeVisible();
  await page.goto(`/clients/${client}?tab=activity`);
  await expect(page.getByRole("link", { name: subject })).toBeVisible();
});

test("the task list filters; a principal reassigns in bulk; others can't", async ({ as }) => {
  const am = await as("mrivera");
  await am.goto("/tasks");
  await expect(am.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(am.getByRole("checkbox", { name: /^Select / })).toHaveCount(0);
  await am.goto("/tasks?view=mine&due=overdue");
  await expect(am.getByRole("heading", { name: "Tasks" })).toBeVisible();

  const page = await as("choll");
  const t = tag();
  await newTask(page, `UATBULK ${t} one`, { due: today });
  await newTask(page, `UATBULK ${t} two`, { due: today });
  await page.goto(`/tasks?view=team&q=${encodeURIComponent(`UATBULK ${t}`)}`);
  const boxes = page.getByRole("checkbox", { name: new RegExp(`^Select UATBULK ${t}`) });
  await expect(boxes).toHaveCount(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.locator('form:has(input[name="ids"]) select[name="owner_id"]').selectOption({ label: "Marisol Rivera" });
  await page.getByRole("button", { name: "Reassign" }).click();
  await expectFlash(page, "Reassigned 2 task(s)");
  await am.goto(`/tasks?q=${encodeURIComponent(`UATBULK ${t}`)}`);
  await expect(am.getByRole("link", { name: new RegExp(`UATBULK ${t}`) })).toHaveCount(2);
});
