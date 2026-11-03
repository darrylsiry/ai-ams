// The findings fixed after the wider review (CR-047..052, SEC-031), against the local database
// (docker compose up -d db; npm run seed). Skipped when it is unreachable. Everything happens in a
// transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { balances, createInvoice, buildProducerStatement, invoiceLinesFor, payCarrierStatement, payProducerStatement, post, sweepable } from "./accounting";
import { renewCertificates, verifyWording } from "./certificates";
import { db, one, q } from "./db";
import { emailTask, ignoreEmail, matchClient } from "./email/ingest";
import { createPolicy, endorsePolicy, setPolicyNumber } from "./policies";

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
const tag = () => crypto.randomUUID().slice(0, 8);

async function newPolicy(c: PoolClient, premium = 1000, lob = "GL") {
  const client = (await one<{ id: number }>("SELECT id FROM clients WHERE kind = 'business' AND status <> 'inactive' ORDER BY id LIMIT 1", [], c))!;
  const carrier = (await one<{ id: number }>("INSERT INTO carriers (code, name) VALUES ($1, $1) RETURNING id", [`T${tag()}`], c))!;
  const producer = (await one<{ id: number }>("SELECT id FROM users WHERE commission_new_pct > 0 ORDER BY id LIMIT 1", [], c))!;
  const id = await createPolicy({ clientId: client.id, policyNumber: `TEST-${tag()}`, carrierId: carrier.id, lob, lines: [lob], effectiveDate: "2031-01-01", termMonths: 12, premium: 0, commissionPct: 10,
    billMode: "agency", isAdmitted: true, paymentPlan: "annual", status: "active", producerId: producer.id }, { ...ME, id: producer.id }, c);
  await c.query("UPDATE policies SET premium = $2 WHERE id = $1", [id, premium]);
  return { id, clientId: client.id, carrierId: carrier.id, producerId: producer.id };
}

const email = async (c: PoolClient, activityId: number | null, clientId: number) => (await one<{ id: number }>(
  "INSERT INTO emails (message_id, from_addr, to_addrs, subject, body_text, received_at, client_id, status, source, activity_id) VALUES ($1,'x@x.example','{}','s','t',now(),$2,'new','test',$3) RETURNING id",
  [`<t-${crypto.randomUUID()}>`, clientId, activityId], c))!.id;

test("CR-047: ignoring a duplicate non-pay email leaves the shared task open; an email with its own task still cancels it", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const status = async (id: number) => (await one<{ status: string }>("SELECT status FROM activities WHERE id = $1", [id], c))!.status;
    const task = async (emailId: number | null) => (await one<{ id: number }>(
      "INSERT INTO activities (code, subject, status, priority, client_id, policy_id, email_id, source, due_date) VALUES ('NONPAY','Non-pay','open','urgent',$1,$2,$3,'email',current_date) RETURNING id", [p.clientId, p.id, emailId], c))!.id;
    const first = await email(c, null, p.clientId);
    const shared = await task(first);
    await c.query("UPDATE emails SET activity_id = $2 WHERE id = $1", [first, shared]);
    assert.equal((await emailTask(first, c)).shared, false, "alone, the email owns its task");
    const dup = await email(c, shared, p.clientId);
    assert.equal((await emailTask(dup, c)).shared, true);
    assert.equal((await emailTask(first, c)).shared, true, "the original can't cancel it for the other email either");
    assert.equal(await ignoreEmail(dup, { id: p.producerId }, c), true);
    assert.equal(await status(shared), "open");
    assert.equal((await one<{ status: string }>("SELECT status FROM emails WHERE id = $1", [dup], c))!.status, "ignored");
    const lone = await email(c, null, p.clientId);
    const own = await task(lone);
    await c.query("UPDATE emails SET activity_id = $2 WHERE id = $1", [lone, own]);
    assert.equal(await ignoreEmail(lone, { id: p.producerId }, c), false);
    assert.equal(await status(own), "cancelled");
  });
});

test("CR-048: a sender on two clients isn't guessed; a merged client's address doesn't match", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const addr = `shared-${tag()}@bookkeeper.example`;
    const [a, b] = await q<{ id: number }>("SELECT id FROM clients WHERE status <> 'inactive' ORDER BY id LIMIT 2", [], c);
    const sender = { addr, name: null };
    await c.query("UPDATE clients SET email = $2 WHERE id = $1", [a.id, addr]);
    let m = await matchClient(sender, "hello", "no other evidence", c);
    assert.equal(m.clientId, a.id, "one client: as before");
    assert.equal(m.confidence, 0.9);
    await c.query("INSERT INTO contacts (client_id, first_name, last_name, email) VALUES ($1,'A','B',$2)", [b.id, addr]);
    m = await matchClient(sender, "hello", "no other evidence", c);
    assert.equal(m.clientId, null, "two clients: no guess");
    await c.query("UPDATE clients SET status = 'inactive' WHERE id = $1", [b.id]);
    m = await matchClient(sender, "hello", "no other evidence", c);
    assert.equal(m.clientId, a.id, "an inactive client no longer counts");
  });
});

test("CR-049: the real policy number replaces a placeholder, audited, and can't be blank", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    await c.query("UPDATE policies SET policy_number = 'PENDING-123456' WHERE id = $1", [p.id]);
    await c.query("SAVEPOINT s");
    await assert.rejects(setPolicyNumber(p.id, "  ", ME, c), /carrier's policy number/);
    await c.query("ROLLBACK TO s");
    await setPolicyNumber(p.id, "GL-REAL-1", ME, c);
    assert.equal((await one<{ policy_number: string }>("SELECT policy_number FROM policies WHERE id = $1", [p.id], c))!.policy_number, "GL-REAL-1");
    assert.equal((await q("SELECT 1 FROM audit_events WHERE action = 'policy.number_changed' AND entity_id = $1", [String(p.id)], c)).length, 1);
  });
});

test("CR-050: wording is checked on every line, and says so where it can't be", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const ai = { additional_insured: true, waiver_of_subrogation: false, primary_noncontributory: false };
    const bop = await newPolicy(c, 1000, "BOP");
    assert.match((await verifyWording([bop.id], ai, c)).join(), /no additional insured endorsement \(BP 04 48\)/);
    await c.query("INSERT INTO policy_forms (policy_id, form_number) VALUES ($1,'BP 04 48')", [bop.id]);
    assert.deepEqual(await verifyWording([bop.id], ai, c), []);
    await c.query("INSERT INTO policy_lines (policy_id, lob, premium) VALUES ($1,'GL',0)", [bop.id]);
    assert.match((await verifyWording([bop.id], ai, c)).join(), /\(GL\): no additional insured/, "a package's extra line counts");
    const umb = await newPolicy(c, 1000, "CUMB");
    assert.match((await verifyWording([umb.id], ai, c)).join(), /can't be verified here/);
    const wc = await newPolicy(c, 1000, "WC");
    assert.deepEqual(await verifyWording([wc.id], ai, c), [], "wording that doesn't apply to a line stays quiet");
  });
});

test("CR-050: a bulk reissue holds back a certificate whose wording the new term doesn't back, with a task", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const next = await newPolicy(c);
    await c.query("UPDATE policies SET client_id = $2, effective_date = current_date, expiration_date = current_date + 365 WHERE id = $1", [next.id, p.clientId]);
    await c.query("UPDATE policies SET renewal_policy_id = $2 WHERE id = $1", [p.id, next.id]);
    await c.query("UPDATE certificates SET status = 'superseded' WHERE client_id = $1 AND status = 'issued'", [p.clientId]);
    const holder = (await one<{ id: number }>("INSERT INTO other_interests (name, kind) VALUES ('Holder','certificate_holder') RETURNING id", [], c))!.id;
    const cert = (await one<{ id: number }>("INSERT INTO certificates (cert_number, client_id, holder_id, additional_insured, status) VALUES ($1,$2,$3,true,'issued') RETURNING id", [`COI-T-${tag()}`, p.clientId, holder], c))!.id;
    await c.query("INSERT INTO certificate_policies (certificate_id, policy_id) VALUES ($1,$2)", [cert, p.id]);
    assert.deepEqual(await renewCertificates(p.clientId, { ...ME, id: p.producerId }, c), { reissued: 0, held: 1 });
    assert.equal((await q("SELECT 1 FROM certificates WHERE renewed_from_id = $1", [cert], c)).length, 0);
    assert.equal((await q("SELECT 1 FROM activities WHERE certificate_id = $1 AND code = 'COI-RENEW'", [cert], c)).length, 1);
  });
});

test("CR-051: a return-only carrier can't be paid, and trust moves only when the return is recorded", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, -1000, c), memo: "Return" }, "test", c);
    const before = await sweepable(c);
    await c.query("SAVEPOINT s");
    await assert.rejects(payCarrierStatement(p.carrierId, "X", ME, c), /owes the agency \$900\.00/);
    await c.query("ROLLBACK TO s");
    assert.equal((await sweepable(c)).available, before.available);
    await c.query("SAVEPOINT s2");
    await assert.rejects(payCarrierStatement(p.carrierId, " ", ME, c, true), /deposit reference/);
    await c.query("ROLLBACK TO s2");
    const trust = (await balances(undefined, c)).trust_cash;
    const st = await payCarrierStatement(p.carrierId, "DEP-1", ME, c, true);
    assert.equal(Math.round(((await balances(undefined, c)).trust_cash - trust) * 100) / 100, 900, "the money arrived");
    const lines = await q<{ debit: string; credit: string }>("SELECT debit, credit FROM ledger_entries WHERE ref_type = 'carrier_statement' AND ref_id = $1", [st], c);
    assert.ok(lines.length === 2 && lines.every((l) => Number(l.debit) >= 0 && Number(l.credit) >= 0));
  });
});

test("CR-051: the ledger takes no negative amounts, whichever way a journal is written", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const client = (await one<{ id: number }>("SELECT id FROM clients ORDER BY id LIMIT 1", [], c))!.id;
    const j = await post({ date: "2031-06-15", memo: "t", refType: "test", refId: 1, clientId: client }, [{ account: "trust_cash", credit: -5 }, { account: "premium_receivable", debit: -5 }], c);
    const lines = await q<{ account: string; debit: string; credit: string }>("SELECT account, debit, credit FROM ledger_entries WHERE journal = $1 ORDER BY account", [j], c);
    assert.deepEqual(lines.map((l) => [l.account, Number(l.debit), Number(l.credit)]), [["premium_receivable", 0, 5], ["trust_cash", 5, 0]]);
    await c.query("SAVEPOINT s");
    await assert.rejects(c.query("INSERT INTO ledger_entries (entry_date, journal, account, debit, credit, memo, ref_type, ref_id) VALUES ('2031-06-15','x','trust_cash',-1,0,'t','test',1)"), /ledger_no_negative_amounts/);
    await c.query("ROLLBACK TO s");
  });
});

test("CR-051: a net-negative producer statement can't be paid, and nets off the next one", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const u = (await one<{ id: number }>("SELECT id FROM users WHERE commission_new_pct > 0 ORDER BY id LIMIT 1", [], c))!.id;
    const old = (await one<{ id: number }>("INSERT INTO producer_statements (user_id, period, total) VALUES ($1,'2031-01',-50) RETURNING id", [u], c))!.id;
    await c.query("SAVEPOINT s");
    await assert.rejects(payProducerStatement(old, ME, c), /nothing to pay/);
    await c.query("ROLLBACK TO s");
    await buildProducerStatement(u, "2031-02", c);
    assert.equal((await q("SELECT 1 FROM producer_statements WHERE id = $1", [old], c)).length, 0, "its lines go back in the pool for the next statement");
  });
});

test("CR-052: a policy created in force counts as issued; one only bound doesn't", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    assert.ok((await one<{ issued_at: Date | null }>("SELECT issued_at FROM policies WHERE id = $1", [p.id], c))!.issued_at);
    const carrier = p.carrierId, client = p.clientId;
    const bound = await createPolicy({ clientId: client, policyNumber: `TEST-${tag()}`, carrierId: carrier, lob: "GL", lines: ["GL"], effectiveDate: "2031-01-01", termMonths: 12, premium: 0, commissionPct: 10, billMode: "direct", isAdmitted: true, paymentPlan: "annual", status: "bound", producerId: p.producerId }, { ...ME, id: p.producerId }, c);
    assert.equal((await one<{ issued_at: Date | null }>("SELECT issued_at FROM policies WHERE id = $1", [bound], c))!.issued_at, null);
  });
});

test("SEC-031: an impossible commission rate or an endorsement below zero is refused", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    await c.query("SAVEPOINT s");
    await assert.rejects(createPolicy({ clientId: p.clientId, policyNumber: `TEST-${tag()}`, carrierId: p.carrierId, lob: "GL", lines: ["GL"], effectiveDate: "2031-01-01", termMonths: 12, premium: 0, commissionPct: 150, billMode: "direct", isAdmitted: true, paymentPlan: "annual", status: "active", producerId: p.producerId }, { ...ME, id: p.producerId }, c), /between 0 and 100/);
    await c.query("ROLLBACK TO s");
    await assert.rejects(endorsePolicy(p.id, { effectiveDate: "2031-02-01", description: "x", premiumChange: -5000, issueNow: true }, { ...ME, id: p.producerId }, c), /below zero/);
    await c.query("ROLLBACK TO s");
  });
});
