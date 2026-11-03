// The queue fixes from the UX review, against the local database (docker compose up -d db; npm run seed).
// Skipped when it is unreachable. Everything happens in a transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pendingCancellationTasks } from "./automation";
import { db, one, q } from "./db";
import { addDays, todayISO, whenDate } from "./format";
import { createPolicy } from "./policies";
import { createActivity, noteOnOpenNonpay, resumeWith } from "./work";

let up = false;
before(async () => { try { await db.query("SELECT 1 FROM activities LIMIT 1"); up = true; } catch { up = false; } });
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

const today = todayISO();
const cancels = addDays(today, 5);

async function pendingPolicy(c: PoolClient) {
  const client = (await one<{ id: number }>("SELECT id FROM clients WHERE kind = 'business' ORDER BY id LIMIT 1", [], c))!;
  const carrier = (await one<{ id: number }>("SELECT id FROM carriers WHERE kind = 'carrier' AND active ORDER BY id LIMIT 1", [], c))!;
  const user = (await one<{ id: number }>("SELECT id FROM users ORDER BY id LIMIT 1", [], c))!;
  const id = await createPolicy({ clientId: client.id, policyNumber: `TEST-${crypto.randomUUID().slice(0, 8)}`, carrierId: carrier.id, lob: "GL", lines: ["GL"], effectiveDate: addDays(today, -30), termMonths: 12, premium: 0, commissionPct: 10,
    billMode: "agency", isAdmitted: true, paymentPlan: "annual", status: "active", producerId: user.id }, { id: user.id, username: "test" }, c);
  await c.query("UPDATE policies SET status = 'pending_cancel', cancel_date = $2 WHERE id = $1", [id, cancels]);
  return { id, clientId: client.id, userId: user.id };
}

const openNonpay = (policyId: number, c: PoolClient) => q<{ id: number; priority: string; source: string }>("SELECT id, priority, source FROM activities WHERE policy_id = $1 AND code = 'NONPAY' AND status IN ('open','waiting')", [policyId], c);

test("UX-003: a policy with an open non-pay task gets a note and Urgent, not a second task, once a day", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await pendingPolicy(c);
    const first = await createActivity({ code: "NONPAY", subject: "Non-pay notice from email", ownerId: p.userId, clientId: p.clientId, policyId: p.id, priority: "normal", source: "email", actor: "test" }, c);
    await pendingCancellationTasks(today, 30, "automation", c);
    await pendingCancellationTasks(today, 30, "automation", c);
    assert.deepEqual(await openNonpay(p.id, c), [{ id: first, priority: "urgent", source: "email" }]);
    const notes = await q<{ body: string; author_id: number | null }>("SELECT body, author_id FROM activity_notes WHERE activity_id = $1", [first], c);
    assert.deepEqual(notes, [{ body: `Daily check: still pending, cancels ${whenDate(cancels)}`, author_id: null }], "running twice in a day notes it once");
  });
});

test("UX-003: a pending cancellation with no open task still gets one, and only one", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await pendingPolicy(c);
    assert.ok(await pendingCancellationTasks(today, 30, "automation", c) >= 1);
    await pendingCancellationTasks(today, 30, "automation", c);
    const open = await openNonpay(p.id, c);
    assert.equal(open.length, 1);
    assert.equal(open[0].source, "automation");
  });
});

test("UX-006: Undo returns a completed task as it was and clears the completion", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await pendingPolicy(c);
    const me = { id: p.userId, username: "test" };
    const id = (await createActivity({ code: "FOLLOW-UP", subject: "Undo me", ownerId: p.userId, clientId: p.clientId, actor: "test" }, c))!;
    const finish = () => c.query("UPDATE activities SET status = 'done', outcome = 'x', completed_at = now(), completed_by_id = $2 WHERE id = $1", [id, p.userId]);
    const state = () => one<{ status: string; outcome: string | null; completed_at: Date | null; completed_by_id: number | null; waiting_on: string | null }>("SELECT status, outcome, completed_at, completed_by_id, waiting_on FROM activities WHERE id = $1", [id], c);

    await finish();
    assert.equal(await resumeWith(id, me, c), true);
    assert.deepEqual(await state(), { status: "open", outcome: null, completed_at: null, completed_by_id: null, waiting_on: null });

    // A chase item completed from the queue comes back as a chase item, so it ranks where it did.
    await c.query("UPDATE activities SET status = 'waiting', waiting_on = 'carrier', follow_up_date = $2 WHERE id = $1", [id, today]);
    await finish();
    assert.equal(await resumeWith(id, me, c), true);
    assert.equal((await state())!.status, "waiting");
    assert.equal((await state())!.waiting_on, "carrier");

    // The ordinary resume still clears the waiting state.
    assert.equal(await resumeWith(id, me, c), false);
    assert.deepEqual([(await state())!.status, (await state())!.waiting_on], ["open", null]);
  });
});

test("UX-003: a second non-pay email joins the open task; with none open, nothing is joined", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await pendingPolicy(c);
    assert.equal(await noteOnOpenNonpay(p.id, "Another non-pay email", c), null);
    const first = await createActivity({ code: "NONPAY", subject: "Non-pay notice", ownerId: p.userId, clientId: p.clientId, policyId: p.id, source: "email", actor: "test" }, c);
    assert.equal(await noteOnOpenNonpay(p.id, "Another non-pay email", c), first);
    assert.equal((await openNonpay(p.id, c)).length, 1);
    assert.equal((await q("SELECT 1 FROM activity_notes WHERE activity_id = $1 AND body = 'Another non-pay email'", [first], c)).length, 1);
  });
});
