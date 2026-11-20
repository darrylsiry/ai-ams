import assert from "node:assert/strict";
import { test } from "node:test";
import { ACCESS_REQUEST_TO, accessRequestEmail, admission, LIMITS, mailtoHref, networkOf, readAccessRequest } from "./access-requests";
import { noticeSender, sendNotice } from "./email/send";

const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

test("a request needs a name and a plain email address; company is optional", () => {
  const ok = readAccessRequest(form({ name: "  Pat  Lee ", email: "pat.lee+ams@agency.example.com", company: "" }));
  assert.deepEqual(ok.errors, {});
  assert.deepEqual(ok.input, { name: "Pat Lee", email: "pat.lee+ams@agency.example.com", company: "" });
  assert.deepEqual(Object.keys(readAccessRequest(form({})).errors).sort(), ["email", "name"]);
  for (const bad of ["pat", "pat@", "@x.com", "pat@x", "a b@x.com", "\"x\"@x.com", "pat@x.com, eve@evil.example", "pat@x.com;eve@evil.example",
    "Pat <pat@x.com>", "pat(c)@x.com", "pat@-x.com", "a?cc=b@c.com", "a&body=x@c.com", "a=b@c.com", "a%40b@c.com", "o'brien@c.com", "a/b@c.com"]) {
    assert.ok(readAccessRequest(form({ name: "Pat", email: bad })).errors.email, `refused: ${bad}`);
  }
});

test("line breaks and control characters never reach a header; long values are capped", () => {
  const r = readAccessRequest(form({ name: "Pat\r\nBcc: eve@evil.example", email: "pat@x.com", company: "Acme\nInc\u0000" }));
  assert.equal(r.input.name, "Pat Bcc: eve@evil.example");
  assert.equal(r.input.company, "Acme Inc");
  assert.equal(readAccessRequest(form({ name: "x".repeat(500), email: "p@x.com" })).input.name.length, 100);
  assert.ok(!/[\r\n]/.test(accessRequestEmail({ ...r.input, at: new Date(), ip: "203.0.113.9", origin: "https://ams.example" }).subject));
});

test("the throttle: a few an hour from one network; past the day's emails a request is kept, not refused", () => {
  const ip = "203.0.113.9";
  const from = (n: number, a: string | null = ip) => Array<string | null>(n).fill(a);
  assert.deepEqual(admission(ip, { addressesLastHour: from(2), emailsLastDay: 29 }), { refused: null, email: true });
  const limited = admission(ip, { addressesLastHour: from(3), emailsLastDay: 3 });
  assert.match(limited.refused ?? "", /last hour/);
  assert.equal(limited.email, false);
  assert.deepEqual(admission(ip, { addressesLastHour: from(LIMITS.perHour - 1, "198.51.100.1"), emailsLastDay: 2 }), { refused: null, email: true }, "another sender doesn't count against this one");
  const many = Array.from({ length: LIMITS.perHour }, (_, i) => `198.51.${i}.7`);
  assert.match(admission(ip, { addressesLastHour: many, emailsLastDay: 0 }).refused ?? "", /more requests than usual/, "SEC-038: a cap across every network");
  assert.equal(admission(ip, { addressesLastHour: many.slice(1), emailsLastDay: 0 }).refused, null);
  assert.deepEqual(admission(ip, { addressesLastHour: [], emailsLastDay: LIMITS.emailsPerDay }), { refused: null, email: false }, "one sender filling the cap can't turn a real person away");
});

test("an IPv6 sender can't rotate through its /64 past the limit", () => {
  assert.equal(networkOf("2600:1702:82d0:bcf::1"), networkOf("2600:1702:82d0:0bcf:b50c:5cac:848d:9d45"));
  const block = ["2600:1702:82d0:bcf::1", "2600:1702:82d0:bcf:aaaa::2", "2600:1702:82d0:0bcf:b50c:5cac:848d:9d45"];
  assert.match(admission("2600:1702:82d0:bcf::ffff", { addressesLastHour: block, emailsLastDay: 0 }).refused ?? "", /last hour/);
  assert.equal(admission("2600:1702:82d0:bd0::1", { addressesLastHour: block, emailsLastDay: 0 }).refused, null, "the next /64 is someone else");
  assert.equal(networkOf("::1"), "0:0:0:0::/64");
  assert.match(admission(null, { addressesLastHour: [null, null, null], emailsLastDay: 0 }).refused ?? "", /last hour/, "with no address on record they share one limit");
});

test("a mailto: link can't pick up extra recipients or a body from a stored address", () => {
  assert.equal(mailtoHref("pat.lee+ams@agency.example.com"), "mailto:pat.lee%2Bams@agency.example.com");
  assert.equal(new URL(mailtoHref("a?cc=b@c.com&body=x")).search, "");
});

test("the owner's email: to the owner, reply goes to the person asking, everything they entered", () => {
  const mail = accessRequestEmail({ name: "Pat Lee", email: "pat@agency.example.com", company: "Broker & Co", at: new Date("2026-11-05T15:30:00Z"), ip: "203.0.113.9", origin: "https://siryous-ams.fly.dev" });
  assert.equal(mail.to, ACCESS_REQUEST_TO);
  assert.equal(ACCESS_REQUEST_TO, "darryl@siryous.com");
  assert.deepEqual(mail.replyTo, { name: "Pat Lee", address: "pat@agency.example.com" });
  assert.equal(mail.subject, "Access request from the siryous AMS sign-in page", "SEC-038: nothing typed goes in the subject");
  assert.match(mail.text, /^Someone asked[^\n]*\n\nNot verified: everything below was typed by a visitor/);
  for (const s of ["Name:     Pat Lee", "Email:    pat@agency.example.com", "Company:  Broker & Co", "Address:  203.0.113.9", "https://siryous-ams.fly.dev/request-access", "https://siryous-ams.fly.dev/reports/users", "scripts/fly-users.sh"]) assert.ok(mail.text.includes(s), s);
  const bare = accessRequestEmail({ name: "Pat", email: "p@x.com", company: "", at: new Date(), ip: null, origin: "http://localhost:3200" }, "ops@example.test");
  assert.ok(!bare.subject.includes("Pat"));
  assert.equal(bare.to, "ops@example.test");
  assert.ok(bare.text.includes("Company:  (not given)") && bare.text.includes("Address:  not recorded"));
});

test("the notice mailer: off without SMTP_URL, never throws, never repeats the password", async () => {
  const msg = { to: "darryl@siryous.com", replyTo: { name: "Pat", address: "p@x.com" }, subject: "s", text: "t" };
  assert.deepEqual(await sendNotice(msg, {}), { sent: false, reason: "Email isn't set up: SMTP_URL is not configured" });
  const env = { SMTP_URL: "smtps://user:secret-pass@smtp.example.com:465", INBOUND_EMAIL_DOMAIN: "amsinbox.siryous.app" };
  assert.equal(noticeSender(env), "siryous AMS <access@amsinbox.siryous.app>");
  assert.equal(noticeSender({ ...env, MAIL_FROM: "Desk <desk@siryous.com>" }), "Desk <desk@siryous.com>");
  let opened: Record<string, unknown> | undefined, sent: Record<string, unknown> | undefined;
  const ok = await sendNotice(msg, env, (o) => { opened = o; return { sendMail: async (m) => { sent = m; return { messageId: "<1@x>" }; } }; });
  assert.deepEqual(ok, { sent: true, id: "<1@x>" });
  assert.ok(Number(opened!.connectionTimeout) <= 10_000, "the form never waits long on a dead server");
  assert.equal(opened!.requireTLS, true);
  assert.deepEqual(sent!.replyTo, msg.replyTo);
  const failed = await sendNotice(msg, env, () => ({ sendMail: async () => { throw new Error("connect failed smtps://user:secret-pass@smtp.example.com"); } }));
  assert.equal(failed.sent, false);
  assert.doesNotMatch(JSON.stringify(failed), /secret-pass/);
  assert.deepEqual(await sendNotice(msg, env, () => ({ sendMail: async () => ({ messageId: "<2@x>", rejected: ["darryl@siryous.com"] }) })), { sent: false, reason: "The mail server refused the address" });
});
