import { test, expect, expectError, expectFlash, field, idFrom, sql, val, saveState, need, tag, DOMAIN, INBOUND_TOKEN } from "./fixtures";
import { randomUUID } from "node:crypto";

// Email to action: the webhook in every format providers use, triage in the inbox, the test intake
// page, and a forwarded certificate request going all the way to an issued certificate.
const URL_ = `/api/inbound/email?token=${INBOUND_TOKEN}`;
const msgId = () => `<uat-${randomUUID()}@uat.example>`;

/** A client of Marisol Rivera's with a contact email and an active GL policy. */
function amClient() {
  const [id, name, email, policy] = sql(`SELECT c.id, c.name, ct.email, p.policy_number FROM clients c JOIN contacts ct ON ct.client_id = c.id AND ct.is_primary AND ct.email IS NOT NULL
    JOIN policies p ON p.client_id = c.id AND p.status = 'active' AND p.lob = 'GL'
    WHERE c.account_manager_id = (SELECT id FROM users WHERE username = 'mrivera') AND c.kind = 'business' AND c.status = 'insured' ORDER BY c.id LIMIT 1`)[0];
  return { id, name, email, policy };
}

test.describe("the inbound webhook", () => {
  test("JSON: routed to the alias, matched by sender, typed by the rules, one task", async ({ anon, as }) => {
    const c = amClient();
    const subject = `Adding a truck ${tag()}`;
    const res = await anon.post(URL_, { data: { from: `Pat Lee <${c.email}>`, to: `mrivera@${DOMAIN}`, subject, text: "Hi,\n\nWe bought a new truck, please add a vehicle to our auto policy. VIN 1FTFW1E50NFA00001.\n\nThanks", messageId: msgId() } });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ ok: true, duplicate: false, activity_code: "END-REQ", routed_to: "Marisol Rivera", client_id: Number(c.id), classified_by: "rules" });
    const page = await as("mrivera");
    await page.goto(`/tasks/${j.activity_id}`);
    await expect(page.getByRole("heading", { name: /Process policy change/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in inbox" })).toBeVisible();
    await expect(page.getByText(subject).first()).toBeVisible();
    await expect(page.getByText("From email")).toBeVisible();
  });

  test("a policy number in the email matches the client even from an unknown sender", async ({ anon }) => {
    const c = amClient();
    const res = await anon.post(URL_, { data: { from: "broker@unknown-agency.example", to: `service@${DOMAIN}`, subject: `Question on ${c.policy}`, text: "Please send a copy of the policy.", messageId: msgId() } });
    const j = await res.json();
    expect(res.status()).toBe(200);
    expect(j.client_id).toBe(Number(c.id));
    expect(j.routed_to, "the shared address goes to the client's account manager").toBe("Marisol Rivera");
  });

  test("raw MIME with an attachment: the attachment is filed and downloads intact", async ({ anon, as }) => {
    const c = amClient();
    const subject = `Our loss runs ${tag()}`;
    const pdf = Buffer.from("%PDF-1.4\n% UAT attachment\n%%EOF\n");
    const boundary = "uat-boundary-1";
    const id = msgId();
    const raw = [`Authentication-Results: test.local; spf=pass smtp.mailfrom=${c.email.split("@")[1]}; dkim=pass header.d=${c.email.split("@")[1]}; dmarc=pass header.from=${c.email.split("@")[1]}`, `From: Pat Lee <${c.email}>`, `To: mrivera@${DOMAIN}`, `Subject: ${subject}`, `Message-ID: ${id}`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
      `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "", "Please see the attached loss runs.", "",
      `--${boundary}`, "Content-Type: application/pdf", 'Content-Disposition: attachment; filename="loss-runs.pdf"', "Content-Transfer-Encoding: base64", "", pdf.toString("base64"), `--${boundary}--`, ""].join("\r\n");
    const res = await anon.post("/api/inbound/email", { headers: { "Content-Type": "message/rfc822", "X-Inbound-Token": INBOUND_TOKEN }, data: raw });
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.activity_code).toBe("LOSS-RUN");
    const page = await as("mrivera");
    await page.goto(`/inbox/${j.email_id}`);
    const att = page.getByRole("link", { name: /loss-runs\.pdf/ });
    await expect(att).toBeVisible();
    const file = await page.request.get((await att.getAttribute("href"))!);
    expect(file.status()).toBe(200);
    expect((await file.body()).equals(pdf), "the bytes that came back are the bytes that went in").toBe(true);
    await page.goto(`/clients/${c.id}?tab=documents`);
    await expect(page.getByRole("link", { name: /loss-runs\.pdf/ }).first()).toBeVisible();
  });

  test("form posts: Mailgun's urlencoded fields and SendGrid's multipart envelope", async ({ anon }) => {
    const c = amClient();
    const mg = await anon.post(URL_, { form: { sender: c.email, from: c.email, recipient: `mrivera@${DOMAIN}`, subject: `Mailgun billing ${tag()}`, "body-plain": "I have a question about my invoice balance.", "Message-Id": msgId() } });
    expect(mg.status()).toBe(200);
    expect(await mg.json()).toMatchObject({ ok: true, activity_code: "BILL-INQ", routed_to: "Marisol Rivera", client_id: Number(c.id) });
    const sg = await anon.post(URL_, { multipart: { from: c.email, to: "someone@else.example", envelope: JSON.stringify({ to: [`mrivera@${DOMAIN}`], from: c.email }), subject: `SendGrid cancel ${tag()}`, text: "Please cancel our policy.",
      "message-id": msgId(), attachment1: { name: "note.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } } });
    expect(sg.status()).toBe(200);
    const j = await sg.json();
    expect(j).toMatchObject({ ok: true, activity_code: "CANC-REQ", routed_to: "Marisol Rivera" });
    expect(val(`select count(*) from documents where email_id = ${j.email_id} and title = 'note.txt'`)).toBe("1");
  });

  test("X-Envelope-To routes to the alias it was delivered to, whatever the To header says", async ({ anon }) => {
    const c = amClient();
    const res = await anon.post(URL_, { headers: { "X-Envelope-To": `jbrooks@${DOMAIN}` }, data: { from: c.email, to: "owner@some-other-company.example", subject: `Envelope ${tag()}`, text: "Please send a copy of the policy.", messageId: msgId() } });
    expect(res.status()).toBe(200);
    expect((await res.json()).routed_to).toBe("Jordan Brooks");
  });

  test("the token: a bad or missing one gets a 401; query, header, bearer and Basic all work", async ({ anon }) => {
    const body = () => ({ from: "x@example.com", to: `service@${DOMAIN}`, subject: `Token check ${tag()}`, text: "Hello", messageId: msgId() });
    const before = val("select count(*) from emails");
    expect((await anon.post("/api/inbound/email?token=wrong", { data: body() })).status()).toBe(401);
    expect((await anon.post("/api/inbound/email", { data: body() })).status()).toBe(401);
    expect(val("select count(*) from emails"), "refused mail isn't stored").toBe(before);
    expect((await anon.post("/api/inbound/email", { headers: { Authorization: `Bearer ${INBOUND_TOKEN}` }, data: body() })).status()).toBe(200);
    expect((await anon.post("/api/inbound/email", { headers: { Authorization: "Basic " + Buffer.from(`postmark:${INBOUND_TOKEN}`).toString("base64") }, data: body() })).status()).toBe(200);
  });

  test("a provider retry with the same Message-ID is idempotent", async ({ anon }) => {
    const c = amClient();
    const data = { from: c.email, to: `mrivera@${DOMAIN}`, subject: `Retry ${tag()}`, text: "Please send proof of insurance.", messageId: msgId() };
    const a = await (await anon.post(URL_, { data })).json();
    const before = val("select count(*) from activities");
    const b = await (await anon.post(URL_, { data })).json();
    expect(b).toMatchObject({ ok: true, duplicate: true, email_id: a.email_id, activity_id: a.activity_id });
    expect(val("select count(*) from activities")).toBe(before);
  });

  test("an out-of-office reply is filed, ignored, and makes no task; no sender is refused", async ({ anon }) => {
    const res = await anon.post(URL_, { data: { from: "away@example.com", to: `service@${DOMAIN}`, subject: "Out of office", text: "I am away.", messageId: msgId() } });
    const j = await res.json();
    expect(j.activity_id).toBeNull();
    expect(val(`select status from emails where id = ${j.email_id}`)).toBe("ignored");
    expect((await anon.post(URL_, { data: { to: `service@${DOMAIN}`, subject: "No sender", text: "?" } })).status()).toBe(422);
  });
});

test.describe("triage in the inbox", () => {
  async function unclear(anon: import("@playwright/test").APIRequestContext) {
    const subject = `Question ${tag()}${Math.random().toString(36).slice(-3)}`;
    const res = await anon.post(URL_, { data: { from: "Sam New <someone.new@gmail.com>", to: `mrivera@${DOMAIN}`, subject, text: "Hey, quick question when you get a sec. Thanks!", messageId: msgId() } });
    expect(res.status()).toBe(200);
    return { subject, ...(await res.json()) as { email_id: number; activity_id: number } };
  }

  test("an unmatched email waits in Needs triage until someone confirms the client, and the task follows", async ({ anon, as }) => {
    const e = await unclear(anon);
    const page = await as("mrivera");
    await page.goto("/inbox");
    const row = page.locator("li").filter({ hasText: e.subject });
    await expect(row).toBeVisible();
    await expect(row.getByText("No client match")).toBeVisible();
    await expect(row.getByRole("button", { name: "Looks right" }), "an email with no client can't be waved through").toHaveCount(0);
    await expect(row.getByRole("link", { name: "Pick client →" })).toBeVisible();
    await row.getByRole("link", { name: e.subject }).click();
    await expect(page.getByRole("heading", { name: "What the intake decided" })).toBeVisible();
    const c = amClient();
    await page.getByRole("combobox", { name: "Client" }).fill(c.name);
    await page.getByRole("option", { name: c.name }).first().click();
    await page.getByRole("button", { name: "Save client" }).click();
    await expectFlash(page, "Client confirmed — the task moved with it");
    await expect(page.getByRole("link", { name: c.name }).first()).toBeVisible();
    await page.goto("/inbox");
    await expect(page.locator("li").filter({ hasText: e.subject }), "it left the triage list").toHaveCount(0);
    await page.goto(`/tasks/${e.activity_id}`);
    await expect(page.getByRole("link", { name: c.name }).first()).toBeVisible();
  });

  test("Looks right clears it from the list; the email stays under All received", async ({ anon, as }) => {
    // Matched to a client but not confirmed: an unverified sender waits in triage.
    const c = amClient();
    const e = { subject: `Question ${tag()}` };
    await anon.post(URL_, { data: { from: `Pat Lee <${c.email}>`, to: `service@${DOMAIN}`, subject: e.subject, messageId: msgId(), senderVerified: false, text: "Please cancel my policy." } });
    const page = await as("mrivera");
    await page.goto("/inbox");
    await page.locator("li").filter({ hasText: e.subject }).getByRole("button", { name: "Looks right" }).click();
    await expectFlash(page, "Marked reviewed");
    await expect(page.locator("li").filter({ hasText: e.subject })).toHaveCount(0);
    await page.getByRole("link", { name: /All received/ }).click();
    await expect(page.locator("li").filter({ hasText: e.subject })).toBeVisible();
  });

  test("change the task type; log a reply", async ({ anon, as }) => {
    const e = await unclear(anon);
    const page = await as("mrivera");
    await page.goto(`/inbox/${e.email_id}`);
    await field(page, "code").selectOption("BILL-INQ");
    await field(page, "subject").fill(`Retyped ${e.subject}`);
    await page.getByRole("button", { name: "Update task" }).click();
    await expectFlash(page, "Task type updated");
    await expect(page.getByRole("link", { name: `Retyped ${e.subject}` })).toBeVisible();
    await page.goto(`/tasks/${e.activity_id}`);
    await expect(page.getByText("Billing").first()).toBeVisible();

    await page.goto(`/inbox/${e.email_id}`);
    await page.getByRole("button", { name: "Send reply" }).click();
    await expectError(page, "Nothing to send");
    await field(page, "body").fill("Happy to help, what's your question?");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expectFlash(page, "Reply logged");
    await page.goto(`/tasks/${e.activity_id}`);
    await expect(page.getByText(/Reply to someone\.new@gmail\.com: Happy to help/)).toBeVisible();
    saveState({ replySubject: `Re: ${e.subject}` });
  });

  test("the reply shows on the sender's own Replies tab", async ({ as }) => {
    const subject = need("replySubject");
    const page = await as("mrivera");
    await page.goto("/inbox?tab=sent");
    await expect(page.getByRole("link", { name: subject })).toBeVisible();
  });

  test("ignoring an email cancels its task", async ({ anon, as }) => {
    const e = await unclear(anon);
    const page = await as("mrivera");
    await page.goto(`/inbox/${e.email_id}`);
    await page.getByRole("button", { name: "Ignore — no action needed" }).click();
    await expectFlash(page, "Ignored");
    await page.goto("/inbox?tab=ignored");
    await expect(page.locator("li").filter({ hasText: e.subject })).toBeVisible();
    await page.goto(`/tasks/${e.activity_id}`);
    await expect(page.getByText(/Cancelled .*Email needs no action/)).toBeVisible();
  });

  test("the inbox scope switch and the search", async ({ as }) => {
    const page = await as("mrivera");
    await page.goto("/inbox");
    await page.getByRole("link", { name: "Show everyone's" }).click();
    await expect(page.getByRole("link", { name: "Show only mine" })).toBeVisible();
    await page.goto("/search?q=Retry");
    await expect(page.getByRole("heading", { name: /Search: “Retry”/ })).toBeVisible();
    await expect(page.locator("section").filter({ hasText: "Email ·" }).first()).toBeVisible();
  });
});

test.describe("the Test email intake page", () => {
  for (const [sample, code, shortcut] of [["auto", "END-REQ", null], ["claim", "CLAIM-FNOL", "Record claim →"], ["cancel", "CANC-REQ", null], ["cert", "CERT-REQ", "Issue certificate →"], ["unclear", "EMAIL-IN", null]] as const) {
    test(`the ${sample} sample becomes a ${code} task`, async ({ as }) => {
      // Test intake is an administrator's tool, and an administrator's samples draw on the whole book.
      const page = await as("admin");
      await page.goto("/inbox");
      await page.getByRole("link", { name: "Test email intake" }).click();
      await page.getByRole("link", { name: sample, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`sample=${sample}`));
      await page.getByRole("button", { name: "Send to intake" }).click();
      await expect(page).toHaveURL(/\/tasks\/\d+/);
      await expectFlash(page, new RegExp(`Email received → ${code} task for`));
      if (shortcut) await expect(page.getByRole("link", { name: shortcut })).toBeVisible();
      await page.goto("/inbox/simulate");
      await expect(page.getByText("Recent tests:")).toBeVisible();
    });
  }

  test("is an administrator's tool: nobody else can open it or sees a way in", async ({ as }) => {
    const page = await as("mrivera");
    await page.goto("/inbox/simulate");
    await expect(page.getByText("You can't open test email intake")).toBeVisible();
    await page.goto("/inbox");
    await expect(page.getByRole("link", { name: "Test email intake" })).toHaveCount(0);
    await page.getByRole("button", { name: /New/ }).click();
    await expect(page.getByRole("menuitem", { name: "Email (test intake)" })).toHaveCount(0);
  });

  test("an .eml upload goes through the same pipeline", async ({ as }) => {
    const page = await as("admin");
    const c = amClient();
    await page.goto("/inbox/simulate");
    const subject = `Eml upload ${tag()}`;
    await field(page, "eml").setInputFiles({ name: "msg.eml", mimeType: "message/rfc822",
      buffer: Buffer.from(`From: ${c.email}\r\nTo: mrivera@${DOMAIN}\r\nSubject: ${subject}\r\nMessage-ID: ${msgId()}\r\n\r\nPlease send our ID cards.\r\n`) });
    await page.getByRole("button", { name: "Send to intake" }).click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    await expectFlash(page, /Email received → ID-CARD task/);
    await expect(page.getByText(subject).first()).toBeVisible();
  });
});

test.describe("a staff member's note when forwarding", () => {
  test("is on the task when the mail uses plain line endings", async ({ anon, as }) => {
    const c = amClient();
    const res = await anon.post(URL_, { data: { from: "Marisol Rivera <mrivera@siryousagency.example>", to: `mrivera@${DOMAIN}`, subject: `Fwd: Billing question ${tag()}`, messageId: msgId(), senderVerified: true,
      text: `Please handle, client called too\n\n---------- Forwarded message ---------\nFrom: Pat Lee <${c.email}>\nSubject: Billing question\n\nI have a question about my invoice.\n\nSecond paragraph.` } });
    const j = await res.json();
    const page = await as("mrivera");
    await page.goto(`/tasks/${j.activity_id}`);
    await expect(page.getByText(/Note from Marisol Rivera: Please handle, client called too/)).toBeVisible();
  });

  test("isn't trusted when the provider didn't verify the staff address", async ({ anon, as }) => {
    const c = amClient();
    const res = await anon.post(URL_, { data: { from: "Marisol Rivera <mrivera@siryousagency.example>", to: `mrivera@${DOMAIN}`, subject: `Fwd: Billing question ${tag()}`, messageId: msgId(),
      text: `Please handle, client called too\n\n---------- Forwarded message ---------\nFrom: Pat Lee <${c.email}>\nSubject: Billing question\n\nI have a question about my invoice.` } });
    const page = await as("mrivera");
    await page.goto(`/tasks/${(await res.json()).activity_id}`);
    await expect(page.getByText(/Sender not verified: this claims to be from Marisol Rivera/)).toBeVisible();
    await expect(page.getByText(/Note from Marisol Rivera/)).toHaveCount(0);
  });

  test("is on the task when it comes from the Test email intake form", async ({ as }) => {
    const page = await as("admin");
    const c = amClient();
    await page.goto("/inbox/simulate");
    await field(page, "from_addr").fill(c.email);
    await field(page, "subject").fill(`Billing question ${tag()}`);
    await field(page, "body").fill("I have a question about my invoice.\n\nSecond paragraph.");
    await field(page, "forwarded").check();
    await field(page, "note").fill("Please handle, client called too");
    await page.getByRole("button", { name: "Send to intake" }).click();
    await expect(page).toHaveURL(/\/tasks\/\d+/);
    await expect(page.getByText(/Note from Morgan Ellis: Please handle, client called too/)).toBeVisible();
  });
});

test.describe("a forged client sender", () => {
  const pdf = Buffer.from("%PDF-1.4\n%uat\n").toString("base64");
  const send = (anon: { post: (u: string, o: object) => Promise<{ json: () => Promise<{ email_id: number; activity_id: number }> }> }, from: string, subject: string, verified: boolean) =>
    anon.post(URL_, { data: { from, to: `service@${DOMAIN}`, subject, messageId: msgId(), senderVerified: verified, text: "Please cancel my policy.", attachments: [{ filename: `${subject}.pdf`, contentType: "application/pdf", content: pdf }] } }).then((r) => r.json());

  test("files nothing and is marked as unverified until staff confirm it", async ({ anon, as }) => {
    const c = amClient();
    const subject = `Unverified request ${tag()}`;
    const j = await send(anon, `Pat Lee <${c.email}>`, subject, false);
    expect(val(`select status from emails where id = ${j.email_id}`), "it waits for a person").toBe("new");
    expect(val(`select count(*) from documents where email_id = ${j.email_id} and client_id is null`), "the attachment is held").toBe("1");
    const page = await as("mrivera");
    await page.goto(`/tasks/${j.activity_id}`);
    await expect(page.getByText("Treat the From line as a claim.")).toBeVisible();
    await expect(page.getByText(/Sender not verified: the mail provider's checks don't confirm this came from/)).toBeVisible();

    await page.goto(`/inbox/${j.email_id}`);
    await expect(page.getByText(/Attachments are held off the client's file/)).toBeVisible();
    await page.getByRole("button", { name: "Looks right" }).click();
    await expectFlash(page, "Marked reviewed");
    expect(val(`select client_id from documents where email_id = ${j.email_id}`), "confirming files the attachment on the client").toBe(c.id);
    expect(val(`select status from emails where id = ${j.email_id}`)).toBe("actioned");
  });

  test("the same mail from a verified sender goes straight through", async ({ anon }) => {
    const c = amClient();
    const j = await send(anon, `Pat Lee <${c.email}>`, `Verified request ${tag()}`, true);
    expect(val(`select status from emails where id = ${j.email_id}`)).toBe("actioned");
    expect(val(`select client_id from documents where email_id = ${j.email_id}`)).toBe(c.id);
  });
});

test.describe("a forwarded certificate request, end to end", () => {
  test("forwarding makes a task that opens the prefilled certificate form", async ({ anon, as }) => {
    const page = await as("mrivera");
    const c = amClient();
    const subject = `Need a COI today ${tag()}`;
    const res = await anon.post(URL_, { data: { from: "Marisol Rivera <mrivera@siryousagency.example>", to: `mrivera@${DOMAIN}`, subject: `Fwd: ${subject}`, messageId: msgId(), senderVerified: true,
      text: `Please handle — client called too\n\n---------- Forwarded message ---------\nFrom: Pat Lee <${c.email}>\nSubject: ${subject}\n\nHi,\n\nCan you send a certificate of insurance to Hendrick Brothers General Contractors for the tenant upfit? They need additional insured with waiver of subrogation and primary/non-contributory. We can't start until they have it.\n\nThanks` } });
    const j = await res.json();
    expect(j).toMatchObject({ activity_code: "CERT-REQ", routed_to: "Marisol Rivera", client_id: Number(c.id) });
    await page.goto(`/tasks/${j.activity_id}`);
    const taskId = idFrom(page.url(), "tasks");
    await expect(page.getByText("forwarded by Marisol Rivera")).toBeVisible();
    await page.getByRole("link", { name: "Issue certificate →" }).click();
    await expect(page).toHaveURL(new RegExp(`/certificates/new\\?client=${c.id}&task=${taskId}`));
    await expect(page.getByText(/For task: Issue certificate/)).toBeVisible();
    await expect(page.getByText(/Request:/)).toBeVisible();
    const holder = val("select id from other_interests where name = 'Hendrick Brothers General Contractors'");
    await expect(field(page, "holder_id"), "the holder named in the email is picked").toHaveValue(holder);
    await expect(field(page, "ai")).toBeChecked();
    await expect(field(page, "wos")).toBeChecked();
    await expect(field(page, "pnc")).toBeChecked();
    expect(await page.locator('input[name="policy_ids"]:checked').count(), "the liability policies are ticked").toBeGreaterThan(0);
    saveState({ certTask: taskId, certClient: c.id });
  });

  test("issuing it closes the task", async ({ as }) => {
    const taskId = need("certTask"), clientId = need("certClient");
    const page = await as("mrivera");
    await page.goto(`/certificates/new?client=${clientId}&task=${taskId}`);
    await field(page, "delivered_to").fill("risk@hendrick.example");
    await field(page, "override").check();
    await page.getByRole("button", { name: "Issue certificate" }).click();
    await expectFlash(page, "Certificate issued — the task is closed");
    await expect(page).toHaveURL(/\/certificates\/\d+/);
    await expect(page.getByText("Hendrick Brothers General Contractors").first()).toBeVisible();
    await page.goto(`/tasks/${taskId}`);
    await expect(page.getByText(/Completed .*Certificate issued; PDF to send manually/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Finish this task" })).toHaveCount(0);
  });
});
