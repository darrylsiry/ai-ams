import { test } from "node:test";
import assert from "node:assert/strict";
import { detectForward, fromGeneric, fromPostmark, fromRaw, newContent, parseAddress, parseAddressList, stripSubjectPrefixes } from "./parse";
import { classifyByRules, deadlineDays, dueDateFor, policyNumberCandidates } from "./rules";

const TODAY = "2026-10-28"; // a Wednesday

test("addresses: names, bare addresses, quoted commas, provider objects", () => {
  assert.deepEqual(parseAddress('"Doe, Jane" <Jane@X.com>'), { addr: "jane@x.com", name: "Doe, Jane" });
  assert.deepEqual(parseAddress("bob@y.org"), { addr: "bob@y.org", name: null });
  assert.equal(parseAddress("not an address"), null);
  assert.deepEqual(parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.org').map((a) => a.addr), ["jane@x.com", "bob@y.org"]);
  assert.deepEqual(parseAddressList([{ Email: "A@B.com", Name: "A" }]), [{ addr: "a@b.com", name: "A" }]);
});

test("Gmail forward: recovers the original sender, subject and body", () => {
  const text = "FYI see below\n\n---------- Forwarded message ---------\nFrom: Dana Price <dprice@summit.example>\nDate: Tue, Oct 27, 2026\nSubject: COI for Main St job\nTo: Marisol <mrivera@agency.example>\n\nWe need a certificate by Friday.\n";
  const f = detectForward("Fwd: COI for Main St job", text);
  assert.ok(f);
  assert.deepEqual(f.from, { addr: "dprice@summit.example", name: "Dana Price" });
  assert.equal(f.subject, "COI for Main St job");
  assert.match(f.body, /certificate by Friday/);
});

test("Outlook forward with mailto noise and bold headers", () => {
  const text = "________________________________\n*From:* Pat Lee [mailto:pat@lee.example] <pat@lee.example>\n*Subject:* Add a driver\n\nPlease add my son.";
  const f = detectForward("FW: Add a driver", text);
  assert.equal(f?.from.addr, "pat@lee.example");
  assert.equal(f?.subject, "Add a driver");
});

test("a plain email is not a forward", () => {
  assert.equal(detectForward("Question", "Hi, quick question about my bill."), null);
});

test("subject prefixes and quoted replies are stripped", () => {
  assert.equal(stripSubjectPrefixes("RE: Fwd: FW: Renewal"), "Renewal");
  assert.equal(newContent("Thanks, that works.\n\nOn Mon, Oct 26, 2026 Jane wrote:\n> old text"), "Thanks, that works.");
  assert.equal(newContent("Got it\n> quoted\n--\nJane"), "Got it");
});

test("raw MIME: parses headers, attachments, and the envelope recipient", async () => {
  const raw = [
    "From: Pat Lee <pat@gmail.com>", "To: mrivera@agency.example", "X-Original-To: mrivera@inbox.siryous.app",
    "Subject: Policy change", "Message-ID: <abc@test>", "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b"', "", "--b", "Content-Type: text/plain", "", "Please add a vehicle.",
    "--b", 'Content-Type: application/pdf; name="bill.pdf"', 'Content-Disposition: attachment; filename="bill.pdf"', "Content-Transfer-Encoding: base64", "",
    Buffer.from("%PDF-1.4 test").toString("base64"), "--b--", "",
  ].join("\r\n");
  const e = await fromRaw(raw);
  assert.equal(e.from.addr, "pat@gmail.com");
  assert.equal(e.messageId, "<abc@test>");
  assert.match(e.text, /add a vehicle/);
  assert.deepEqual(e.envelopeTo?.map((a) => a.addr), ["mrivera@inbox.siryous.app"]);
  assert.equal(e.attachments.length, 1);
  assert.equal(e.attachments[0].filename, "bill.pdf");
});

test("Postmark and generic JSON shapes, envelope recipient included", () => {
  const p = fromPostmark({ FromFull: { Email: "A@B.com", Name: "A" }, ToFull: [{ Email: "x@y.com" }], OriginalRecipient: "jbrooks@inbox.siryous.app", Subject: "Hi", TextBody: "Body",
    Headers: [{ Name: "Message-ID", Value: "<m1>" }], Attachments: [{ Name: "a.txt", ContentType: "text/plain", Content: Buffer.from("hi").toString("base64") }] });
  assert.equal(p.from.addr, "a@b.com");
  assert.equal(p.messageId, "<m1>");
  assert.equal(p.envelopeTo?.[0].addr, "jbrooks@inbox.siryous.app");
  assert.equal(p.attachments[0].data.toString(), "hi");
  const g = fromGeneric({ from: "c@d.com", to: "service@inbox.siryous.app", subject: "S", html: "<p>Hello<br>there</p>" });
  assert.match(g.text, /Hello\nthere/);
});

test("rules: each common request gets the right activity code", () => {
  const code = (subject: string, body = "") => classifyByRules(subject, body, TODAY).activity_code;
  assert.equal(code("Certificate request", "Please name ABC Builders as additional insured with waiver of subrogation."), "CERT-REQ");
  assert.equal(code("Notice of cancellation for non-payment"), "NONPAY");
  assert.equal(code("Accident this morning", "I was rear-ended on I-40, nobody injured."), "CLAIM-FNOL");
  assert.equal(code("New truck", "We bought a 2026 F-250, VIN 1FT7W2BT0NEC12345. Please add it."), "END-REQ");
  assert.equal(code("Please cancel my policy", "We sold the house."), "CANC-REQ");
  assert.equal(code("Need ID cards"), "ID-CARD");
  assert.equal(code("Question about my invoice"), "BILL-INQ");
  assert.equal(code("Lunch next week?", "Want to grab lunch?"), "EMAIL-IN");
});

test("rules: urgency, auto-replies and deadlines", () => {
  const cert = classifyByRules("COI needed ASAP", "We can't start the job without a certificate.", TODAY);
  assert.equal(cert.priority, "urgent");
  assert.equal(cert.due_in_days, 0);
  assert.equal(classifyByRules("Notice of cancellation - non-payment", "", TODAY).priority, "urgent", "coverage at risk is urgent without asking");
  const ooo = classifyByRules("Out of Office: Re: renewal", "I am away", TODAY);
  assert.equal(ooo.auto_reply, true);
  assert.equal(ooo.priority, "low");
});

test("deadlines the sender names", () => {
  assert.equal(deadlineDays("need it today", TODAY), 0);
  assert.equal(deadlineDays("by tomorrow please", TODAY), 1);
  assert.equal(deadlineDays("by Friday", TODAY), 2);
  assert.equal(deadlineDays("by Wednesday", TODAY), 7, "the same weekday means next week");
  assert.equal(deadlineDays("by next Friday", TODAY), 9);
  assert.equal(deadlineDays("whenever", TODAY), null);
  const c = classifyByRules("COI", "by Friday", TODAY);
  assert.equal(dueDateFor(c, 3, TODAY), "2026-10-30");
  assert.equal(dueDateFor({ ...c, due_in_days: null }, 3, TODAY), "2026-10-31");
});

test("policy numbers are found; dates and phone numbers are not", () => {
  assert.deepEqual(policyNumberCandidates("Re: policy CPP-4481203 renewal, call 919-555-1234 by 2026-11-01"), ["CPP-4481203"]);
  assert.equal(classifyByRules("Policy BOP2291847 question", "", TODAY).policy_number, "BOP2291847");
});
