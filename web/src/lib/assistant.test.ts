import { test } from "node:test";
import assert from "node:assert/strict";
import { askAssistant, cleanHistory, MAX_AT_ONCE, MAX_PER_HOUR, runTool, startQuestion, SYSTEM_PROMPT, type AssistantEvent, type Create } from "./assistant";
import type { AppTool, AssistantContext } from "./assistant-tools";
import { toolsFor } from "./assistant-tools";
import { scrubText } from "./redact";
import { inlineText, isAppLink, onlyAppLinks, parseMarkdown, type Block } from "./markdown";

const ctx: AssistantContext = { user: { id: 1, username: "pat", full_name: "Pat Lee", role: "csr", can_view_pii: false }, today: "2026-11-03" };
const message = (content: unknown[], stop_reason: string) => ({ content, stop_reason, model: "m", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2 } });
const scripted = (replies: unknown[], seen: unknown[][] = []): Create => (async (params: { messages: unknown[] }) => { seen.push(JSON.parse(JSON.stringify(params.messages))); return replies.shift(); }) as unknown as Create;
const collect = async (it: AsyncGenerator<AssistantEvent>) => { const out: AssistantEvent[] = []; for await (const e of it) out.push(e); return out; };
const echo: AppTool = { name: "echo", description: "", input_schema: { type: "object", properties: {} }, run: async (a) => ({ got: a }) };

test("a question runs the tool the model asks for, feeds back the result, and ends with the answer and its usage", async () => {
  const seen: unknown[][] = [];
  const events = await collect(askAssistant("hello", [], ctx, { tools: [echo], create: scripted([
    message([{ type: "tool_use", id: "t1", name: "echo", input: { x: 1 } }], "tool_use"),
    message([{ type: "text", text: "Done [it](/clients/1)" }], "end_turn"),
  ], seen) }));
  assert.deepEqual(events.map((e) => e.type), ["status", "tool", "tool_result", "answer"]);
  const answer = events.at(-1) as Extract<AssistantEvent, { type: "answer" }>;
  assert.equal(answer.markdown, "Done [it](/clients/1)");
  assert.equal(answer.steps, 2);
  assert.deepEqual(answer.usage, { input: 20, output: 10, cache_read: 4 });
  assert.match(JSON.stringify(seen[1]), /tool_result.*\{\\"got\\":\{\\"x\\":1\}\}/);
});

test("the question says who is asking, and identifiers are scrubbed before it leaves", async () => {
  const seen: unknown[][] = [];
  await collect(askAssistant("Is 123-45-6789 on file?", [{ role: "user", text: "DOB: 01/02/1980" }, { role: "assistant", text: "ok" }], ctx, { tools: [], create: scripted([message([{ type: "text", text: "no" }], "end_turn")], seen) }));
  const sent = JSON.stringify(seen[0]);
  assert.match(sent, /signed in as pat, role: Customer service rep/);
  assert.doesNotMatch(sent, /123-45-6789/);
  assert.doesNotMatch(sent, /01\/02\/1980/);
});

test("turns sent to the API alternate, however the browser's history looks", async () => {
  const seen: { role: string }[][] = [];
  await collect(askAssistant("next", [{ role: "assistant", text: "stray" }, { role: "user", text: "a" }, { role: "user", text: "b" }, { role: "assistant", text: "c" }, { role: "user", text: "failed turn" }], ctx,
    { tools: [], create: scripted([message([{ type: "text", text: "ok" }], "end_turn")], seen as unknown[][]) }));
  assert.deepEqual(seen[0].map((m) => m.role), ["user", "assistant", "user"]);
});

test("a refusal, an empty answer and an API failure end in a plain error", async () => {
  assert.equal((await collect(askAssistant("q", [], ctx, { tools: [], create: scripted([message([], "refusal")]) }))).at(-1)!.type, "error");
  assert.match(JSON.stringify((await collect(askAssistant("q", [], ctx, { tools: [], create: scripted([message([], "end_turn")]) }))).at(-1)), /no answer/);
  const failing = (async () => { throw new Error("secret detail"); }) as unknown as Create;
  const last = (await collect(askAssistant("q", [], ctx, { tools: [], create: failing }))).at(-1) as { message: string };
  assert.doesNotMatch(last.message, /secret detail/, "internals stay in the server log");
});

test("it can't loop forever, and Stop and the deadline end a stalled call", async () => {
  const always = (async () => message([{ type: "tool_use", id: "t", name: "echo", input: {} }], "tool_use")) as unknown as Create;
  assert.match(JSON.stringify((await collect(askAssistant("q", [], ctx, { tools: [echo], create: always }))).at(-1)), /Stopped after 12 rounds/);
  const stall = (() => new Promise(() => {})) as unknown as Create;
  assert.match(JSON.stringify((await collect(askAssistant("q", [], ctx, { tools: [], create: stall, deadlineMs: 20 }))).at(-1)), /without an answer/);
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 10);
  assert.match(JSON.stringify((await collect(askAssistant("q", [], ctx, { tools: [], create: stall, signal: stop.signal }))).at(-1)), /Stopped\./);
});

test("a tool that fails or isn't this person's comes back as an error, without internals", async () => {
  assert.deepEqual(await runTool([echo], "audit_search", {}, ctx), { content: "Unknown tool audit_search", isError: true });
  const boom: AppTool = { ...echo, run: async () => { throw new Error("password=abc"); } };
  const r = await runTool([boom], "echo", {}, ctx);
  assert.equal(r.isError, true);
  assert.doesNotMatch(r.content, /password/);
  const big: AppTool = { ...echo, run: async () => ({ text: "x".repeat(100_000) }) };
  assert.match((await runTool([big], "echo", {}, ctx)).content, /truncated at 60000/);
});

test("tools follow the role: what can't be opened on screen isn't offered", () => {
  const names = (role: string) => toolsFor({ ...ctx.user, role: role as "csr" }).map((t) => t.name);
  const has = (role: string, tool: string) => names(role).includes(tool);
  for (const tool of ["list_invoices", "accounting_overview", "ledger_summary", "list_receipts"]) {
    assert.ok(!has("csr", tool) && !has("producer", tool) && !has("readonly", tool), tool);
    assert.ok(has("accounting", tool) && has("account_manager", tool) && has("admin", tool), tool);
  }
  for (const tool of ["book_summary", "production_report", "team_activity_report", "list_carriers"]) {
    assert.ok(!has("csr", tool) && !has("account_manager", tool) && !has("producer", tool), tool);
    assert.ok(has("principal", tool) && has("accounting", tool), tool);
  }
  assert.ok(has("admin", "audit_search") && !has("principal", "audit_search") && !has("accounting", "audit_search"));
  assert.ok(has("principal", "team_workload") && !has("account_manager", "team_workload"));
  assert.ok(has("producer", "my_production") && !has("admin", "my_production"));
  assert.ok(has("readonly", "search_app"));
});

test("the rules travel with every question", () => {
  assert.match(SYSTEM_PROMPT, /read-only/);
  assert.match(SYSTEM_PROMPT, /<untrusted>/);
  assert.match(SYSTEM_PROMPT, /Never invent a URL/);
});

test("history from the browser is cleaned", () => {
  assert.deepEqual(cleanHistory("nope"), []);
  assert.deepEqual(cleanHistory([{ role: "system", text: "x" }, { role: "user", text: " " }, { role: "user", text: 5 }, null, { role: "user", text: "ok" }]), [{ role: "user", text: "ok" }]);
  assert.equal(cleanHistory([{ role: "user", text: "y".repeat(50_000) }])[0].text.length, 12_000);
  assert.equal(cleanHistory(Array.from({ length: 40 }, () => ({ role: "user", text: "a" }))).length, 12);
});

test("one person's use is limited, at once and by the hour", () => {
  const id = 900_001, now = 1_000_000_000;
  const a = startQuestion(id, now) as { release: () => void };
  const running = Array.from({ length: MAX_AT_ONCE - 1 }, () => startQuestion(id, now) as { release: () => void });
  assert.ok("refused" in startQuestion(id, now));
  a.release();
  a.release();   // twice must not free two places
  running.forEach((r) => r.release());
  const hourly = 900_002;
  for (let i = 0; i < MAX_PER_HOUR; i++) (startQuestion(hourly, now) as { release: () => void }).release();
  assert.match(JSON.stringify(startQuestion(hourly, now)), /in the last hour/);
  assert.ok("release" in startQuestion(hourly, now + 3_700_000), "an hour later there's room again");
});

test("answers can only link inside the app", () => {
  for (const bad of ["https://evil.example/?d=x", "//evil.example", "javascript:alert(1)", "/\\evil.example", "/assistant?q=spend", "/signout", "mailto:a@b.c", "/a b", "/task/13678", "/clients/abc", "/assistant", "/signin?next=https://evil.example", "/api/health"]) assert.equal(isAppLink(bad), false, bad);
  for (const good of ["/", "/clients/12", "/clients/12?tab=billing", "/policies/3?tab=renewal", "/policies/3?action=nonpay", "/documents/render?kind=certificate&certificate=1", "/tasks?view=user&user=3", "/inbox", "/renewals?view=mine&days=60", "/accounting/commissions/82", "/accounting/ledger?month=2026-11", "/reports/my-production", "/admin/audit", "/sales/4"]) assert.equal(isAppLink(good), true, good);
  const blocks = onlyAppLinks(parseMarkdown("See [the portal](https://evil.example/x) and **[bold](http://e.example)** and [Acme](/clients/1).\n\n| a |\n|---|\n| [t](https://evil.example) |\n\n- [li](//evil.example)"));
  const json = JSON.stringify(blocks);
  assert.doesNotMatch(json, /evil|e\.example/);
  assert.match(json, /"href":"\/clients\/1"/);
  assert.match(inlineText((blocks[0] as Extract<Block, { type: "paragraph" }>).children), /See the portal and bold and Acme/);
});

test("the identifier filter catches the forms people actually type, and leaves ordinary words alone", () => {
  for (const [text, secret] of [["SSN 123456789", "123456789"], ["SSN: 123 45 6789", "6789"], ["Social 123.45.6789", "6789"], ["FEIN 123456789", "123456789"], ["EIN 12 3456789", "3456789"], ["DOB is 01/02/1980", "1980"], ["DOB: Jan 5, 1980", "1980"], ["born 1/2/1980", "1980"], ["date of birth is 1980-01-02", "1980"], ["License: D1234567", "D1234567"], ["license number D1234567", "D1234567"], ["driver's license is S530123456", "S530123456"], ["DL NC 1234567", "1234567"]] as const) {
    assert.ok(!scrubText(text).includes(secret), text);
  }
  for (const fine of ["drivers license renewal is due", "Call (919) 555-0142 about BOP-2072257", "Policy GRM-PA8247280-04 renews 2026-11-09", "Premium was 123456789 last year"]) assert.equal(scrubText(fine), fine);
});

test("every tool result goes through the filter, whatever field it's in", async () => {
  const leaky: AppTool = { ...echo, run: async () => ({ subject: "New driver SSN 123-45-6789", deep: [{ reference: "FEIN 12-3456789" }] }) };
  const r = await runTool([leaky], "echo", {}, ctx);
  assert.doesNotMatch(r.content, /6789/);
  assert.doesNotThrow(() => JSON.parse(r.content), "still valid JSON");
});

test("a question can only read so much", async () => {
  const big = (async () => ({ ...message([{ type: "tool_use", id: "t", name: "echo", input: {} }], "tool_use"), usage: { input_tokens: 500_000, output_tokens: 1 } })) as unknown as Create;
  assert.match(JSON.stringify((await collect(askAssistant("q", [], ctx, { tools: [echo], create: big }))).at(-1)), /more data than one question/);
});

test("a planted link can't dress up as the app's own message or an export", () => {
  for (const bad of ["/inbox?msg=Call+555+to+verify", "/clients/1?error=Sign+in+again", "/reports/csv?r=book", "/tasks?view=mine&msg=x", "/clients/1?a?b"]) assert.equal(isAppLink(bad), false, bad);
  for (const good of ["/tasks/new", "/accounting/receipts/new", "/clients/new", "/renewals?days=45&owner=3"]) assert.equal(isAppLink(good), true, good);
});

test("answers read correctly: ranked lists keep their numbers and addresses stay whole", () => {
  const list = parseMarkdown("1. a\n\n2. b\n\n3. c");
  assert.equal(list.length, 1);
  assert.deepEqual([(list[0] as Extract<Block, { type: "list" }>).start, (list[0] as Extract<Block, { type: "list" }>).items.length], [1, 3]);
  assert.equal((parseMarkdown("5. x")[0] as Extract<Block, { type: "list" }>).start, 5);
  assert.equal(parseMarkdown("- a\n\n1. b").length, 2, "a different kind of list is still a new one");
  assert.equal(inlineText((parseMarkdown("john_doe_smith@x.example")[0] as Extract<Block, { type: "paragraph" }>).children), "john_doe_smith@x.example");
  assert.deepEqual(JSON.stringify(parseMarkdown("_note_")).includes('"em"'), true, "real emphasis still works");
  assert.equal((parseMarkdown("| a |\n|---|\n| x \\| y |")[0] as Extract<Block, { type: "table" }>).rows[0].length, 1);
});
