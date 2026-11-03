// UX findings whose logic lives in lib, against the local database (docker compose up -d db; npm run seed).
// Skipped when it is unreachable. Everything happens in a transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { notifyOtherPolicies } from "./claims";
import { db, one, q } from "./db";
import { confirmEmailReviewed, EmailNeedsClient, retypeEmail } from "./email/ingest";
import { ROADMAP, roadmapBadge } from "./roadmap";
import { createPolicy } from "./policies";

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

test("UX-019: staff see 'Needs setup' on pending features and 'Coming later' on the rest", () => {
  assert.equal(roadmapBadge(ROADMAP["CSH-09"]), "Needs setup");
  assert.equal(roadmapBadge(ROADMAP["WRK-23"]), "Coming later");
  assert.equal(roadmapBadge(undefined), "Coming later");
});

async function policyOn(clientId: number, lob: string, me: { id: number; username: string }, c: PoolClient) {
  const carrier = (await one<{ id: number }>("SELECT id FROM carriers WHERE kind = 'carrier' AND active ORDER BY id LIMIT 1", [], c))!;
  const number = `UX-${crypto.randomUUID().slice(0, 8)}`;
  const id = await createPolicy({ clientId, policyNumber: number, carrierId: carrier.id, lob, lines: [lob], effectiveDate: "2031-01-01", termMonths: 12, premium: 0, commissionPct: 10, billMode: "direct", isAdmitted: true, paymentPlan: "annual", status: "active", producerId: null }, me, c);
  return { id, number };
}

test("UX-017: each other policy ticked gets one notify task on the claim; the main policy and other clients' policies don't", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const [client, other] = await q<{ id: number }>("SELECT id FROM clients WHERE kind = 'business' ORDER BY id LIMIT 2", [], c);
    const user = (await one<{ id: number }>("SELECT id FROM users ORDER BY id LIMIT 1", [], c))!;
    const me = { id: user.id, username: "test" };
    const gl = await policyOn(client.id, "GL", me, c);
    const umbrella = await policyOn(client.id, "CUMB", me, c);
    const stranger = await policyOn(other.id, "GL", me, c);
    const claim = (await one<{ id: number }>("INSERT INTO claims (claim_number, client_id, policy_id, loss_date, reported_date, kind, description) VALUES ($1,$2,$3,current_date,current_date,'Other','x') RETURNING id", [`T-${crypto.randomUUID().slice(0, 8)}`, client.id, gl.id], c))!;
    const n = await notifyOtherPolicies({ id: claim.id, number: "CLM-T", clientId: client.id, policyId: gl.id }, [gl.id, umbrella.id, umbrella.id, stranger.id, 0, NaN], user.id, me, c);
    assert.equal(n, 1);
    const tasks = await q<{ subject: string; policy_id: number; owner_id: number; status: string }>("SELECT subject, policy_id, owner_id, status FROM activities WHERE claim_id = $1", [claim.id], c);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].policy_id, umbrella.id);
    assert.equal(tasks[0].owner_id, user.id);
    assert.equal(tasks[0].status, "open");
    assert.match(tasks[0].subject, new RegExp(`^Notify carrier: .*${umbrella.number}.*CLM-T`));
    assert.equal(await notifyOtherPolicies({ id: claim.id, number: "CLM-T", clientId: client.id, policyId: gl.id }, [], user.id, me, c), 0);
  });
});

test("UX-038: an unmatched email can't leave triage by Looks right or a retype; a matched one can", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const client = (await one<{ id: number }>("SELECT id FROM clients ORDER BY id LIMIT 1", [], c))!;
    const mk = async (clientId: number | null) => (await one<{ id: number }>(
      "INSERT INTO emails (message_id, from_addr, to_addrs, subject, body_text, received_at, client_id, status, source) VALUES ($1,'x@x.example','{}','s','t',now(),$2,'new','test') RETURNING id",
      [`<t-${crypto.randomUUID()}>`, clientId], c))!.id;
    const status = async (id: number) => (await one<{ status: string }>("SELECT status FROM emails WHERE id = $1", [id], c))!.status;
    const unmatched = await mk(null);
    await assert.rejects(confirmEmailReviewed(unmatched, c), EmailNeedsClient);
    assert.equal(await status(unmatched), "new");
    await retypeEmail(unmatched, "BILL-INQ", c);
    assert.equal(await status(unmatched), "new");
    const code = (await one<{ code: string }>("SELECT classification->>'activity_code' AS code FROM emails WHERE id = $1", [unmatched], c))!.code;
    assert.equal(code, "BILL-INQ");
    const matched = await mk(client.id);
    await retypeEmail(matched, "BILL-INQ", c);
    assert.equal(await status(matched), "actioned");
  });
});
