// Pure checks behind the code and security review fixes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { basicUsername, bootstrapAdmin, isPublicPath } from "./basic-auth";
import { csvCell } from "./csv";
import { detectForward, fromRaw, newContent, senderAuthenticated } from "./email/parse";
import { documentHeaders, safeLocalPath, sniffType, storedMime } from "./http";
import { itemDetails, maskPii, scrubText } from "./redact";
import { rangeFrom } from "./reports";
import { classifyByRules } from "./email/rules";
import { mayActOn } from "./permissions";
import { readSession, signSession, verifySession } from "./session";
import { clearFailures, failureCount, isThrottled, noteFailure } from "./throttle";

const PDF = new TextEncoder().encode("%PDF-1.7 rest");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

test("SEC-001: only a PDF or image whose bytes match is shown in the browser", () => {
  assert.equal(sniffType(PDF), "application/pdf");
  for (const [mime, data] of [["image/svg+xml", SVG], ["text/html", SVG], ["application/xhtml+xml", SVG], ["image/png", SVG], ["application/pdf", SVG]] as const) {
    const h = documentHeaders("x", mime, data);
    assert.equal(h["Content-Type"], "application/octet-stream", mime);
    assert.match(h["Content-Disposition"], /^attachment/, mime);
    assert.match(h["Content-Security-Policy"], /sandbox/, mime);
  }
  assert.equal(documentHeaders("a.pdf", "application/pdf", PDF)["Content-Type"], "application/pdf");
  assert.match(documentHeaders("a.pdf", "application/pdf", PDF)["Content-Disposition"], /^inline/);
  assert.match(documentHeaders("a.png", "image/png", PNG)["Content-Security-Policy"], /sandbox/);
});

test("SEC-001: what is stored can't be a type a browser would run", () => {
  assert.equal(storedMime("image/svg+xml", SVG), "application/octet-stream");
  assert.equal(storedMime("text/html; charset=utf-8", SVG), "application/octet-stream");
  assert.equal(storedMime("application/pdf", SVG), "application/octet-stream");
  assert.equal(storedMime("application/pdf", PDF), "application/pdf");
  assert.equal(storedMime("text/csv", SVG), "text/csv");
  assert.equal(storedMime("", SVG), "application/octet-stream");
});

test("SEC-003: a cookie carries the session version; old cookies read as version 0", () => {
  const exp = new Date(Date.now() + 60_000);
  assert.equal(readSession(signSession("a", "k", exp, 3), "k")?.version, 3);
  assert.equal(readSession(signSession("a", "k", exp), "k")?.version, 0);
  assert.equal(verifySession(signSession("a", "k", exp), "other"), null);
});

test("SEC-004: the sign-in redirect stays on this site", () => {
  for (const bad of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\\evil", "//evil", "https://evil.example", "evil", "/ /evil"]) assert.equal(safeLocalPath(bad), "/", JSON.stringify(bad));
  assert.equal(safeLocalPath("/tasks/1?tab=a&b=c"), "/tasks/1?tab=a&b=c");
  assert.equal(safeLocalPath("/"), "/");
});

test("SEC-007/SEC-002: identifiers are masked, however deep, and absent values stay absent", () => {
  assert.deepEqual(maskPii({ name: "A", dob: "1970-01-01", fein: null, nested: [{ drivers_license: "X" }] }), { name: "A", dob: "[changed]", fein: null, nested: [{ drivers_license: "[changed]" }] });
});

test("SEC-010: formulas are neutralized, numbers stay numbers", () => {
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("@cmd"), "'@cmd");
  assert.equal(csvCell("-5"), "-5");
  assert.equal(csvCell("-5.25"), "-5.25");
  assert.equal(csvCell(-5), "-5");
  assert.equal(csvCell("-cmd"), "'-cmd");
  assert.equal(csvCell('=HYPERLINK("x","y")'), `"'=HYPERLINK(""x"",""y"")"`);
  assert.equal(csvCell(null), "");
});

test("SEC-013: five failures in a minute, then refused; a success or a minute clears it", () => {
  const k = `t-${Math.random()}`, t = 1_000_000;
  for (let i = 0; i < 5; i++) { assert.equal(isThrottled(k, t), false); noteFailure(k, t); }
  assert.equal(isThrottled(k, t), true);
  assert.equal(isThrottled(k, t + 61_000), false);
  clearFailures(k);
  assert.equal(isThrottled(k, t), false);
});

test("SEC-014: public paths match exactly", () => {
  for (const p of ["/quote", "/signin", "/signout", "/api/leads", "/api/live", "/api/inbound/email", "/api/cron/daily"]) assert.ok(isPublicPath(p), p);
  for (const p of ["/quotes", "/quotesx", "/signin-help", "/signout2", "/api/leadsx", "/api/inboundx", "/api/cronjobs", "/"]) assert.ok(!isPublicPath(p), p);
  assert.equal(basicUsername(`Basic ${Buffer.from("a:b").toString("base64")}`), "a");
});

test("SEC-008: only the provider's result for the From domain counts", () => {
  const env = { INBOUND_AUTHSERV_ID: "mx.example" };
  assert.ok(senderAuthenticated("mx.example; dkim=pass header.d=agency.example; spf=fail", undefined, "a@agency.example", env));
  assert.ok(senderAuthenticated("mx.example; spf=pass smtp.mailfrom=bounce@mail.agency.example", undefined, "a@agency.example", env));
  assert.ok(senderAuthenticated(undefined, "Pass (sender SPF authorized) identity=mailfrom; envelope-from=\"a@agency.example\";", "a@agency.example", { INBOUND_TRUST_RECEIVED_SPF: "1" }));
  assert.ok(!senderAuthenticated("mx.example; dkim=pass header.d=attacker.example", undefined, "a@agency.example", env));
  assert.ok(!senderAuthenticated("mx.example; dkim=fail header.d=agency.example", undefined, "a@agency.example", env));
  assert.ok(!senderAuthenticated(undefined, "Fail (domain of a@agency.example)", "a@agency.example", { INBOUND_TRUST_RECEIVED_SPF: "1" }));
  assert.ok(!senderAuthenticated(undefined, undefined, "a@agency.example", env));
  // Written by the sender: a foreign server's name, no provider configured, or a Received-SPF nobody vouches for.
  assert.ok(!senderAuthenticated("evil.example; dkim=pass header.d=agency.example", undefined, "a@agency.example", env));
  assert.ok(!senderAuthenticated("mx.example; dkim=pass header.d=agency.example", undefined, "a@agency.example", {}));
  assert.ok(!senderAuthenticated(undefined, "Pass envelope-from=\"a@agency.example\";", "a@agency.example", env));
  // Only the provider's own result counts, wherever a forged one sits.
  assert.ok(!senderAuthenticated(["evil.example; dkim=pass header.d=agency.example", "mx.example; dkim=fail header.d=agency.example"], undefined, "a@agency.example", env));
  assert.ok(senderAuthenticated(["evil.example; dkim=fail", "mx.example; dkim=pass header.d=agency.example"], undefined, "a@agency.example", env));
});

test("SEC-022: identifier-shaped text is removed from prompts", () => {
  const out = scrubText("SSN 123-45-6789, FEIN 12-3456789, DOB: 01/02/1970, driver's license: D1234567, policy GL-2026-001");
  for (const gone of ["123-45-6789", "12-3456789", "01/02/1970", "D1234567"]) assert.ok(!out.includes(gone), gone);
  assert.ok(out.includes("GL-2026-001"));
});

test("CR-003: an Outlook reply is not a forward, unless staff sent it or the subject says so", () => {
  const body = "Need it by Friday\n\n________________________________\nFrom: Marisol Rivera <mrivera@agency.example>\nSubject: COI\n\nOriginal text";
  assert.equal(detectForward("RE: COI", body), null);
  assert.equal(detectForward("RE: COI", body, true)?.from.addr, "mrivera@agency.example");
  assert.equal(detectForward("FW: COI", body)?.from.addr, "mrivera@agency.example");
  assert.equal(newContent(body), "Need it by Friday");
});

test("SEC-008: a raw message's forged Authentication-Results doesn't verify the sender", async () => {
  const raw = (id: string) => `Authentication-Results: ${id}; dkim=pass header.d=agency.example\r\nFrom: A <a@agency.example>\r\nTo: b@x.example\r\nSubject: s\r\n\r\nbody\r\n`;
  const before = process.env.INBOUND_AUTHSERV_ID;
  process.env.INBOUND_AUTHSERV_ID = "mx.example";
  try {
    assert.equal((await fromRaw(raw("evil.example"))).senderVerified, false);
    assert.equal((await fromRaw(raw("mx.example"))).senderVerified, true);
  } finally {
    if (before === undefined) delete process.env.INBOUND_AUTHSERV_ID; else process.env.INBOUND_AUTHSERV_ID = before;
  }
});

test("SEC-023: a driver's identifiers are hidden without the PII flag, a vehicle's aren't", () => {
  const driver = { dob: "1970-03-15", license_state: "NC", identifier: "NC123456", year: "1970-03-15", violations: 0 };
  const shown = JSON.stringify(itemDetails("driver", driver, false));
  assert.ok(!shown.includes("1970") && !shown.includes("03-15") && !shown.includes("NC123456"));
  assert.ok(shown.includes("license state"));
  assert.ok(JSON.stringify(itemDetails("driver", driver, true)).includes("1970-03-15"));
  assert.ok(JSON.stringify(itemDetails("vehicle", { identifier: "1FTVIN", year: 2024 }, false)).includes("1FTVIN"));
});

test("SEC-024: a redirect field can't leave the site", () => {
  for (const bad of ["https://evil.example/x", "//evil.example", "/\\\\evil.example"]) assert.equal(safeLocalPath(bad), "/");
  assert.equal(safeLocalPath("/clients/5?tab=documents"), "/clients/5?tab=documents");
});

test("SEC-025: a failed-attempt count is readable, and CR-029: the bootstrap admin is the first login", () => {
  noteFailure("t-count", 1000); noteFailure("t-count", 2000);
  assert.equal(failureCount("t-count", 2500), 2);
  assert.equal(failureCount("t-count", 70_000), 0);
  assert.equal(bootstrapAdmin({ BASIC_AUTH_USERS: "first:pw,second:pw" }), "first");
  assert.equal(bootstrapAdmin({ BASIC_AUTH_USERS: "first:pw", AMS_ADMIN_USER: "boss" }), "boss");
  assert.equal(bootstrapAdmin({}), null);
});

test("UAT-F12: a preset beats a report's default start date; with no preset the default applies", () => {
  const to = "2026-11-02";
  assert.equal(rangeFrom({ days: "30", to }, "2026-01-01").from, "2026-10-04");
  assert.equal(rangeFrom({ to }, "2026-01-01").from, "2026-01-01");
  assert.equal(rangeFrom({ from: "2026-03-01", to }, "2026-01-01").from, "2026-03-01");
  assert.equal(rangeFrom({ to }).from, "2026-10-04");
});


test("UAT-F10: a cancellation request is recognised however it's worded", () => {
  for (const [subject, body] of [["Cancel policy GL-1234", "We no longer need it."], ["Second location", "We sold the second location and need to cancel policy GL-1234."], ["Coverage", "Please cancel our insurance."]])
    assert.equal(classifyByRules(subject, body, "2026-11-02", "Acme").activity_code, "CANC-REQ", subject);
  assert.notEqual(classifyByRules("Hello", "Can you cancel our lunch on Friday?", "2026-11-02", "Acme").activity_code, "CANC-REQ");
});

test("UAT-F11: a forward's note survives CRLF line endings and whitespace-only lines", () => {
  const f = detectForward("Fwd: Bill", "Please handle\r\n\r\n---------- Forwarded message ---------\r\nFrom: Pat <pat@x.example>\r\nSubject: Bill\r\n\r\nFirst.\r\n \r\nSecond.", true);
  assert.equal(newContent(f!.note).trim(), "Please handle");
});

test("SEC-027: a role that can't write can't act on unassigned work; others keep what they had", () => {
  const as = (role: string, id = 1) => ({ id, role, can_view_pii: false }) as Parameters<typeof mayActOn>[0];
  assert.equal(mayActOn(as("readonly"), null), false);
  assert.equal(mayActOn(as("readonly"), 1), false, "not even a task someone assigned to it");
  assert.equal(mayActOn(as("producer"), null), true);
  assert.equal(mayActOn(as("producer"), 1), true);
  assert.equal(mayActOn(as("producer"), 2), false);
  assert.equal(mayActOn(as("admin"), 2), true);
});
