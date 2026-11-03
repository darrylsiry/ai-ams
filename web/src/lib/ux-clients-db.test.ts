// The logic behind the client, policy and sales UX changes, against the local database (docker compose up -d db;
// npm run seed). Skipped when it is unreachable. Everything happens in a transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { mergeCounts, searchClients } from "./client-search";
import { db, one } from "./db";
import { fieldsOf, rejected } from "./form-state";
import { createPolicy, endorsementMarker, endorsePolicy, renewalFollowUp, renewalWindowDays, taskWaitingOnTransaction } from "./policies";

let up = false;
before(async () => { try { await db.query("SELECT 1 FROM clients LIMIT 1"); up = true; } catch { up = false; } });
after(async () => { await db.end(); });

async function rolledBack(fn: (c: PoolClient) => Promise<void>) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

const ME = { id: 0, username: "test" };

async function newPolicy(c: PoolClient, effectiveDate = "2031-01-01") {
  const client = (await one<{ id: number }>("SELECT id FROM clients WHERE kind = 'business' ORDER BY id LIMIT 1", [], c))!;
  const carrier = (await one<{ id: number }>("SELECT id FROM carriers WHERE kind = 'carrier' AND active ORDER BY id LIMIT 1", [], c))!;
  const user = (await one<{ id: number }>("SELECT id FROM users ORDER BY id LIMIT 1", [], c))!;
  const id = await createPolicy({ clientId: client.id, policyNumber: `TEST-${crypto.randomUUID().slice(0, 8)}`, carrierId: carrier.id, lob: "GL", lines: ["GL"], effectiveDate, termMonths: 12, premium: 1000, commissionPct: 10,
    billMode: "direct", isAdmitted: true, paymentPlan: "annual", status: "active" }, { ...ME, id: user.id }, c);
  return { id, clientId: client.id, userId: user.id };
}

/** A task on the policy whose notes say it waits on this transaction, the way the endorse form leaves it. */
async function waitingTask(c: PoolClient, p: { id: number; clientId: number; userId: number }, txId: number, status = "waiting") {
  const t = (await one<{ id: number }>("INSERT INTO activities (code, subject, status, waiting_on, client_id, policy_id) VALUES ('END-REQ', 'Add a truck', $1, 'carrier', $2, $3) RETURNING id", [status, p.clientId, p.id], c))!;
  await c.query("INSERT INTO activity_notes (activity_id, client_id, author_id, kind, body) VALUES ($1,$2,$3,'system',$4)", [t.id, p.clientId, p.userId, `Waiting on carrier — follow up 2031-01-06. ${endorsementMarker(txId)}`]);
  return t.id;
}

test("UX-009: a rejected form keeps what was typed, repeated fields included, without React's own fields", () => {
  const f = new FormData();
  f.set("name", "Brown Electric");
  f.set("do_not_call", "on");
  f.append("lines", "GL");
  f.append("lines", "CA");
  f.set("$ACTION_ID_abc", "");
  f.set("file", new File(["x"], "x.txt"));
  const r = rejected(f, "Nope");
  assert.equal(r.error, "Nope");
  assert.deepEqual(r.values, { name: "Brown Electric", do_not_call: "on", lines: ["GL", "CA"] });
  const { text, on, all } = fieldsOf(r);
  assert.equal(text("name", "ignored"), "Brown Electric");
  assert.equal(text("phone", "ignored"), "", "a field left blank stays blank, not back to its starting value");
  assert.equal(on("do_not_call"), true);
  assert.equal(on("create_lead_task", true), false, "an unticked box stays unticked");
  assert.deepEqual(all("lines"), ["GL", "CA"]);
});

test("UX-009: before any rejection a form shows its starting values", () => {
  const { text, on, all } = fieldsOf(null);
  assert.equal(text("state", "NC"), "NC");
  assert.equal(on("create_lead_task", true), true);
  assert.deepEqual(all("lines", ["GL"]), ["GL"]);
});

test("UX-008: a pending endorsement finds the task waiting on it, and only that one", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const first = await endorsePolicy(p.id, { effectiveDate: "2031-02-01", description: "Add a truck", premiumChange: 100, issueNow: false }, { ...ME, id: p.userId }, c);
    const second = await endorsePolicy(p.id, { effectiveDate: "2031-02-01", description: "Add a van", premiumChange: 100, issueNow: false }, { ...ME, id: p.userId }, c);
    const a = await waitingTask(c, p, first), b = await waitingTask(c, p, second);
    assert.equal(await taskWaitingOnTransaction(first, c), a);
    assert.equal(await taskWaitingOnTransaction(second, c), b);
    assert.equal(await taskWaitingOnTransaction(Number(`${first}0`), c), null, "#12 isn't #120");
    assert.equal((await one<{ premium: string }>("SELECT premium FROM policies WHERE id = $1", [p.id], c))!.premium, "1000.00", "pending changes nothing");
  });
});

test("UX-008: a task that has closed since isn't closed again", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const tx = await endorsePolicy(p.id, { effectiveDate: "2031-02-01", description: "Add a truck", premiumChange: 0, issueNow: false }, { ...ME, id: p.userId }, c);
    await waitingTask(c, p, tx, "done");
    assert.equal(await taskWaitingOnTransaction(tx, c), null);
  });
});

test("UX-035: the renewal window is the longest lead time, never short of the pipeline's 120 days", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    await c.query("DELETE FROM settings WHERE key = 'renewal_lead_days'");
    assert.equal(await renewalWindowDays(c), 120);
    await c.query(`INSERT INTO settings (key, value) VALUES ('renewal_lead_days', '{"personal":45,"commercial_small":90,"commercial_large":150}')`);
    assert.equal(await renewalWindowDays(c), 150);
  });
});

test("UX-035: next steps count the renewal tasks closed and the certificates still on the old term", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const prior = await newPolicy(c, "2030-01-01");
    const next = await newPolicy(c, "2031-01-01");
    const before = await renewalFollowUp(prior.id, prior.clientId, c);
    await c.query("UPDATE policies SET renewal_policy_id = $2, status = 'expired' WHERE id = $1", [prior.id, next.id]);
    await c.query("UPDATE policies SET prior_policy_id = $2, expiration_date = '2099-01-01' WHERE id = $1", [next.id, prior.id]);
    await c.query("INSERT INTO activities (code, subject, status, outcome, client_id, policy_id) VALUES ('REN-REVIEW', 'Review', 'done', 'Renewed', $1, $2), ('REN-PROC', 'Process', 'open', NULL, $1, $2)", [prior.clientId, prior.id]);
    const holder = (await one<{ id: number }>("INSERT INTO other_interests (name, kind) VALUES ('UX Holder', 'certificate_holder') RETURNING id", [], c))!;
    const cert = async (status: string) => {
      const ce = (await one<{ id: number }>("INSERT INTO certificates (cert_number, client_id, holder_id, status) VALUES ($1,$2,$3,$4) RETURNING id", [`UX-${crypto.randomUUID().slice(0, 8)}`, prior.clientId, holder.id, status], c))!;
      await c.query("INSERT INTO certificate_policies (certificate_id, policy_id) VALUES ($1,$2)", [ce.id, prior.id]);
    };
    await cert("issued");
    await cert("superseded");
    const r = await renewalFollowUp(prior.id, prior.clientId, c);
    assert.equal(r.tasks, 1);
    assert.equal(r.certificates - before.certificates, 1, "only the current certificate");
  });
});

test("UX-018: picker results carry the status, and the merge summary counts what moves", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const code = (await one<{ code: string }>("SELECT code FROM clients WHERE id = $1", [p.clientId], c))!.code;
    const hit = (await searchClients(code, {}, c)).find((m) => m.id === p.clientId);
    assert.ok(hit?.status, "status comes with the match");
    const counts = (await mergeCounts(p.clientId, c))!;
    const policies = (await one<{ n: number }>("SELECT count(*)::int AS n FROM policies WHERE client_id = $1", [p.clientId], c))!.n;
    assert.equal(counts.policies, policies);
    assert.ok(counts.tasks >= 1, "a new policy brings its setup tasks");
    assert.equal(typeof counts.invoices, "number");
  });
});
