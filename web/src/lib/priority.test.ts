import { test } from "node:test";
import assert from "node:assert/strict";
import { bucket, daysLeft, inQueue, rank, scoreTask, type QueueTask } from "./priority";

const TODAY = "2026-10-30";
const NOW = new Date("2026-10-30T14:00:00Z");

const task = (over: Partial<QueueTask> = {}): QueueTask => ({
  id: 1, code: "GEN", category: "Service", subject: "Task", status: "open", priority: "normal",
  due_date: TODAY, follow_up_date: null, waiting_on: null, snoozed_until: null, source: "manual",
  created_at: NOW, client_premium: null, policy_expiration: null, sla_hours: null, ...over,
});

test("priority level orders otherwise identical tasks", () => {
  const s = (p: QueueTask["priority"]) => scoreTask(task({ priority: p }), TODAY, NOW).score;
  assert.ok(s("urgent") > s("high") && s("high") > s("normal") && s("normal") > s("low"));
});

test("overdue work outranks work due today, and grows with lateness up to a cap", () => {
  const due = (d: string) => scoreTask(task({ due_date: d }), TODAY, NOW);
  assert.ok(due("2026-10-29").score > due(TODAY).score);
  assert.ok(due("2026-10-25").score > due("2026-10-29").score);
  assert.equal(due("2026-09-01").score, due("2026-10-10").score, "lateness is capped at 10 days");
  assert.deepEqual(due("2026-10-27").reasons.map((r) => r.label), ["3d overdue"]);
});

test("future work loses points the further out it is", () => {
  assert.ok(scoreTask(task({ due_date: "2026-11-02" }), TODAY, NOW).score < scoreTask(task(), TODAY, NOW).score);
});

test("coverage-at-risk codes jump the queue and explain why", () => {
  const nonpay = scoreTask(task({ code: "NONPAY", due_date: "2026-11-03" }), TODAY, NOW);
  const routine = scoreTask(task({ code: "GEN" }), TODAY, NOW);
  assert.ok(nonpay.score > routine.score, "a non-pay notice due next week beats routine work due today");
  assert.ok(nonpay.reasons.some((r) => r.label === "Coverage at risk: non-pay" && r.tone === "red"));
});

test("renewals gain urgency as expiration nears", () => {
  const ren = (exp: string) => scoreTask(task({ category: "Renewal", code: "REN-REVIEW", policy_expiration: exp }), TODAY, NOW);
  assert.ok(ren("2026-11-05").score > ren("2026-11-20").score);
  assert.ok(ren("2026-11-20").score > ren("2026-12-20").score);
  assert.ok(ren("2026-10-20").reasons.some((r) => r.label === "Policy already expired"));
});

test("UX-007: a renewal lapsing within three days is coverage at risk, and no chip reads 0d", () => {
  const ren = (exp: string, o: Partial<QueueTask> = {}) => scoreTask(task({ category: "Renewal", code: "REN-REVIEW", policy_expiration: exp, ...o }), TODAY, NOW);
  const chip = (exp: string) => ren(exp).reasons[0];
  assert.deepEqual(chip("2026-10-30"), { label: "Coverage at risk: lapses today", tone: "red" });
  assert.equal(chip("2026-10-31").label, "Coverage at risk: lapses tomorrow");
  assert.equal(chip("2026-11-02").label, "Coverage at risk: lapses in 3d");
  assert.ok(!ren("2026-11-03").reasons.some((r) => r.label.startsWith("Coverage at risk")), "four days out is an ordinary expiry");
  assert.equal(ren("2026-11-02").score, ren("2026-11-03").score + 45, "worth 45 more than the same renewal a day later");
  assert.ok(!["2026-10-30", "2026-10-31", "2026-11-02", "2026-11-14"].flatMap((e) => ren(e).reasons).some((r) => /\b0d\b/.test(r.label)));
  const lateEndorsement = scoreTask(task({ code: "END-REQ", due_date: "2026-10-26" }), TODAY, NOW);
  assert.ok(ren("2026-10-30").score > lateEndorsement.score, "a lapse today beats a late endorsement");
  const nonpay = scoreTask(task({ code: "NONPAY", priority: "urgent" }), TODAY, NOW);
  assert.ok(nonpay.score - ren("2026-10-30", { priority: "high" }).score <= 10, "a high-priority renewal lapsing today sits among the non-pay items");
  assert.ok(ren("2026-10-20").score >= ren("2026-10-30").score, "coverage already gone ranks no lower than coverage lapsing");
  const binder = scoreTask(task({ code: "BINDER-EXP", policy_expiration: "2026-10-31" }), TODAY, NOW);
  assert.equal(binder.reasons[0].label, "Coverage at risk: lapses tomorrow");
});

test("UX-007: days left read as words at zero and one", () => {
  assert.deepEqual([0, 1, 2, 45].map(daysLeft), ["today", "tomorrow", "2d", "45d"]);
});

test("policy expiration only matters for renewal and binder work", () => {
  const a = scoreTask(task({ code: "BILL-INQ", policy_expiration: "2026-11-01" }), TODAY, NOW);
  assert.equal(a.score, scoreTask(task({ code: "BILL-INQ" }), TODAY, NOW).score);
});

test("key accounts get a bump", () => {
  const key = scoreTask(task({ client_premium: 40_000 }), TODAY, NOW);
  assert.ok(key.score > scoreTask(task({ client_premium: 2_000 }), TODAY, NOW).score);
  assert.ok(key.reasons.some((r) => r.label === "Key account"));
});

test("emails waiting past their service standard rank higher", () => {
  const fresh = scoreTask(task({ source: "email", created_at: new Date("2026-10-30T12:00:00Z"), sla_hours: 4 }), TODAY, NOW);
  const stale = scoreTask(task({ source: "email", created_at: new Date("2026-10-28T12:00:00Z"), sla_hours: 4 }), TODAY, NOW);
  assert.ok(stale.score > fresh.score);
  assert.ok(stale.reasons.some((r) => r.label === "Past 4h service standard"));
  assert.ok(fresh.reasons.some((r) => r.label === "From email"));
});

test("waiting tasks return as chase items on their follow-up date", () => {
  const w = task({ status: "waiting", waiting_on: "carrier", due_date: "2026-10-01", follow_up_date: "2026-11-02" });
  assert.equal(inQueue(w, TODAY), false);
  assert.equal(inQueue({ ...w, follow_up_date: TODAY }, TODAY), true);
  const scored = scoreTask({ ...w, follow_up_date: TODAY }, TODAY, NOW);
  assert.equal(scored.chase, true);
  assert.equal(scored.reasons[0].label, "Chase carrier");
});

test("snoozed and finished tasks stay out of the queue", () => {
  assert.equal(inQueue(task({ snoozed_until: "2026-11-01" }), TODAY), false);
  assert.equal(inQueue(task({ snoozed_until: TODAY }), TODAY), true);
  assert.equal(inQueue(task({ status: "done" }), TODAY), false);
  assert.equal(inQueue(task({ status: "cancelled" }), TODAY), false);
});

test("rank sorts by score, then the older due date, then id", () => {
  const ranked = rank([
    task({ id: 3 }),
    task({ id: 2 }),
    task({ id: 1, code: "NONPAY" }),
    task({ id: 4, status: "done" }),
  ], TODAY, NOW);
  assert.deepEqual(ranked.map((t) => t.id), [1, 2, 3]);
});

test("buckets: urgent or overdue is now, due today is today, the rest is later", () => {
  const b = (o: Partial<QueueTask>) => bucket(scoreTask(task(o), TODAY, NOW), TODAY);
  assert.equal(b({ priority: "urgent", due_date: "2026-11-15" }), "now");
  assert.equal(b({ due_date: "2026-10-29" }), "now");
  assert.equal(b({}), "today");
  assert.equal(b({ due_date: "2026-11-02" }), "later");
});
