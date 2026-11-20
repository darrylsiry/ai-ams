// The money and lifecycle paths the code review found untested (CR-024), against the local database
// (docker compose up -d db; npm run seed). Skipped when it is unreachable. Everything happens in a
// transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { applyCredit, balances, buildProducerStatement, clientOwed, createInvoice, createReceipt, findTermForLine, invoiceBalance, invoiceLinesFor, matchCommissionLines, payCarrierStatement, refundInvoice, reverseReceipt, sweepable, voidCredit } from "./accounting";
import { pastDueInvoices } from "./automation";
import { issueCertificate, policiesNotInForce } from "./certificates";
import { db, one, q } from "./db";
import { confirmEmailReviewed, relinkEmail, route } from "./email/ingest";
import { teamQueue } from "./work";
import { confirmNonpayCancellation, createPolicy, endorsePolicy, finalizeCancellation, renewPolicy } from "./policies";

let up = false;
before(async () => { try { await db.query("SELECT session_version FROM users LIMIT 1"); await db.query("SELECT 1 FROM clients LIMIT 1"); up = true; } catch { up = false; } });
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

/** A fresh agency-bill policy on an insured client, with a producer who earns splits. */
async function newPolicy(c: PoolClient, number = `TEST-${crypto.randomUUID().slice(0, 8)}`, effectiveDate = "2031-01-01", premium = 1000) {
  const client = (await one<{ id: number }>("SELECT id FROM clients WHERE kind = 'business' ORDER BY id LIMIT 1", [], c))!;
  const carrier = (await one<{ id: number }>("SELECT id FROM carriers WHERE kind = 'carrier' AND active ORDER BY id LIMIT 1", [], c))!;
  const producer = (await one<{ id: number }>("SELECT id FROM users WHERE commission_new_pct > 0 ORDER BY id LIMIT 1", [], c))!;
  const id = await createPolicy({ clientId: client.id, policyNumber: number, carrierId: carrier.id, lob: "GL", lines: ["GL"], effectiveDate, termMonths: 12, premium: 0, commissionPct: 10,
    billMode: "agency", isAdmitted: true, paymentPlan: "annual", status: "active", producerId: producer.id }, { ...ME, id: producer.id }, c);
  await c.query("UPDATE policies SET premium = $2 WHERE id = $1", [id, premium]);
  return { id, clientId: client.id, carrierId: carrier.id, producerId: producer.id, number };
}

test("CR-001: an unrefunded client credit reduces what can be swept, and the sweep is capped at trust cash", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const start = await sweepable(c);
    const inv = await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, 1000, c) }, "test", c);
    await createReceipt({ clientId: p.clientId, amount: 1000, method: "check", applyTo: [inv] }, { ...ME, id: p.producerId }, c);
    const paid = await sweepable(c);
    assert.ok(Math.abs(paid.available - start.available - 100) < 0.02, "the $100 commission is what became sweepable");
    await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, -500, c), memo: "Return premium" }, "test", c);
    const credited = await sweepable(c);
    assert.ok(Math.abs(credited.credits - start.credits - 500) < 0.02);
    assert.ok(credited.available <= credited.trust);
    assert.ok(credited.available < paid.available, "a client credit can't make more money sweepable");
  });
});

test("CR-006: commission collected after its month closed is paid once, in the month it was collected", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const inv = await createInvoice({ clientId: p.clientId, policyId: p.id, issueDate: "2031-03-10", lines: await invoiceLinesFor(p.id, 1000, c) }, "test", c);
    const line = (await one<{ id: number }>("SELECT id FROM invoice_lines WHERE invoice_id = $1 AND commission_amount <> 0", [inv], c))!;
    const onStatements = () => q<{ period: string }>("SELECT ps.period FROM producer_statement_lines l JOIN producer_statements ps ON ps.id = l.statement_id WHERE l.invoice_line_id = $1", [line.id], c);
    await buildProducerStatement(p.producerId, "2031-03", c);
    assert.deepEqual(await onStatements(), [], "not collected yet");
    await createReceipt({ clientId: p.clientId, amount: 1000, method: "check", date: "2031-04-05", applyTo: [inv] }, { ...ME, id: p.producerId }, c);
    await buildProducerStatement(p.producerId, "2031-03", c);
    assert.deepEqual(await onStatements(), [], "rebuilding March doesn't pick up April's cash");
    await buildProducerStatement(p.producerId, "2031-04", c);
    await buildProducerStatement(p.producerId, "2031-05", c);
    await buildProducerStatement(p.producerId, "2031-04", c);
    assert.deepEqual(await onStatements(), [{ period: "2031-04" }]);
  });
});

test("CR-013: a receipt can't over-apply, or apply to an invoice that isn't this client's", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const inv = await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, 300, c) }, "test", c);
    await createReceipt({ clientId: p.clientId, amount: 1000, method: "check", applyTo: [inv] }, { ...ME, id: p.producerId }, c);
    assert.equal(await invoiceBalance(inv, c), 0);
    const applied = await one<{ a: string }>("SELECT sum(amount)::text AS a FROM receipt_applications WHERE invoice_id = $1", [inv], c);
    assert.equal(Number(applied!.a), 300);
    await c.query("SAVEPOINT s");
    await assert.rejects(createReceipt({ clientId: p.clientId, amount: 10, method: "check", applyTo: [999_999_999] }, { ...ME, id: p.producerId }, c), /isn't open/);
    await c.query("ROLLBACK TO s");
  });
});

test("CR-011: voiding a credit puts the ledger back; a refunded one can't be voided", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const before = await sweepable(c);
    const cr = await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, -500, c) }, "test", c);
    assert.equal(await voidCredit(cr, "test", "test", c), true);
    const after = await sweepable(c);
    assert.ok(Math.abs(after.credits - before.credits) < 0.02);
    const journal = await one<{ bal: string }>("SELECT sum(debit - credit)::text AS bal FROM ledger_entries WHERE ref_type = 'invoice' AND ref_id = $1", [cr], c);
    assert.equal(Number(journal!.bal), 0);
    const net = await q<{ account: string; n: string }>("SELECT account, sum(debit - credit)::text AS n FROM ledger_entries WHERE ref_type = 'invoice' AND ref_id = $1 GROUP BY account", [cr], c);
    for (const r of net) assert.equal(Number(r.n), 0, r.account);
  });
});

test("CR-004: a notice past its date becomes a real cancellation, with its credit and audit row", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    await c.query("UPDATE policies SET status = 'pending_cancel', cancel_date = '2031-02-01', cancel_reason = 'Non-payment', return_premium = 200 WHERE id = $1", [p.id]);
    await c.query("INSERT INTO policy_transactions (policy_id, kind, status, effective_date, description, premium_change) VALUES ($1,'cancellation','pending','2031-02-01','Notice',-200)", [p.id]);
    await finalizeCancellation(p.id, { username: "automation" }, c);
    assert.equal((await one<{ status: string }>("SELECT status FROM policies WHERE id = $1", [p.id], c))!.status, "cancelled");
    assert.equal((await q("SELECT 1 FROM policy_transactions WHERE policy_id = $1 AND kind = 'cancellation' AND status = 'pending'", [p.id], c)).length, 0);
    assert.equal((await q("SELECT 1 FROM audit_events WHERE entity_type = 'policy' AND entity_id = $1 AND action = 'policy.cancelled' AND actor = 'automation'", [String(p.id)], c)).length, 1);
    assert.equal(Number((await one<{ t: string }>("SELECT sum(total)::text AS t FROM invoices WHERE policy_id = $1", [p.id], c))!.t), -200);
    await c.query("SAVEPOINT s");
    await assert.rejects(finalizeCancellation(p.id, { username: "automation" }, c), /pending cancellation/);
    await c.query("ROLLBACK TO s");
  });
});

test("CR-005: certificates refuse coverage not in force, and say so once it stops", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const holder = (await one<{ id: number }>("INSERT INTO other_interests (name, kind) VALUES ('Test holder','certificate_holder') RETURNING id", [], c))!;
    const flags = { additional_insured: false, waiver_of_subrogation: false, primary_noncontributory: false };
    const id = await issueCertificate({ ...flags, clientId: p.clientId, holderId: holder.id, policyIds: [p.id], description: null, deliveredTo: null }, { ...ME, id: p.producerId }, c);
    assert.deepEqual(await policiesNotInForce(id, c), []);
    await c.query("UPDATE policies SET status = 'cancelled' WHERE id = $1", [p.id]);
    assert.deepEqual(await policiesNotInForce(id, c), [`${p.number} (cancelled)`]);
    await c.query("SAVEPOINT s");
    await assert.rejects(issueCertificate({ ...flags, clientId: p.clientId, holderId: holder.id, policyIds: [p.id], description: null, deliveredTo: null }, { ...ME, id: p.producerId }, c), /in force/);
    await c.query("ROLLBACK TO s");
  });
});

test("CR-012: a line goes to the term its date falls in, within the carrier", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const a = await newPolicy(c, "TEST-SAME-NUMBER", "2031-01-01");
    const b = await newPolicy(c, "TEST-SAME-NUMBER", "2032-01-01");
    assert.equal((await findTermForLine("TEST-SAME-NUMBER", a.carrierId, "2031-06-01", c))?.id, a.id);
    assert.equal((await findTermForLine("TEST-SAME-NUMBER", a.carrierId, "2032-06-01", c))?.id, b.id);
    assert.equal((await findTermForLine("TEST-SAME-NUMBER", a.carrierId, null, c))?.id, b.id);
    assert.equal(await findTermForLine("TEST-SAME-NUMBER", -1, null, c), null);
  });
});

test("SEC-008: a staff From address without the provider's say-so isn't treated as staff", async (t) => {
  if (!up) return t.skip("no database");
  const staff = (await one<{ email: string; id: number }>("SELECT email, id FROM users WHERE active ORDER BY id LIMIT 1"))!;
  const mail = (senderVerified: boolean) => ({ messageId: null, from: { addr: staff.email.toLowerCase(), name: null }, to: [{ addr: "service@x.example", name: null }], cc: [], subject: "s", text: "t", html: null, date: new Date(), attachments: [], senderVerified });
  const spoofed = await route(mail(false));
  assert.equal(spoofed.forwardedBy, null);
  assert.equal(spoofed.user, null);
  assert.equal(spoofed.unverifiedStaff?.id, staff.id);
  const genuine = await route(mail(true));
  assert.equal(genuine.forwardedBy?.id, staff.id);
});

/** Put a policy on a brand-new carrier, so only this test's journals count toward what that carrier is owed. */
async function onNewCarrier(c: PoolClient, policyId: number): Promise<number> {
  const id = (await one<{ id: number }>("INSERT INTO carriers (code, name) VALUES ($1, $1) RETURNING id", [`T${crypto.randomUUID().slice(0, 8)}`], c))!.id;
  await c.query("UPDATE policies SET carrier_id = $2, wholesaler_id = NULL WHERE id = $1", [policyId, id]);
  return id;
}

test("CR-026: one carrier's unpaid return can't offset what another carrier is owed", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const a = await newPolicy(c), b = await newPolicy(c);
    await onNewCarrier(c, a.id);
    await onNewCarrier(c, b.id);
    const start = await sweepable(c);
    // Carrier A: the client paid $1,000 and A hasn't been paid, so $900 is owed.
    const invA = await createInvoice({ clientId: a.clientId, policyId: a.id, lines: await invoiceLinesFor(a.id, 1000, c) }, "test", c);
    await createReceipt({ clientId: a.clientId, amount: 1000, method: "check", applyTo: [invA] }, { ...ME, id: a.producerId }, c);
    // Carrier B: a $500 return premium B hasn't sent back. The client is owed it; B's debit balance is no cash.
    await createInvoice({ clientId: b.clientId, policyId: b.id, lines: await invoiceLinesFor(b.id, -500, c) }, "test", c);
    const s = await sweepable(c);
    assert.ok(Math.abs(s.carriers - start.carriers - 900) < 0.02, `carriers rose by ${s.carriers - start.carriers}`);
    assert.ok(Math.abs(s.credits - start.credits - 500) < 0.02);
    assert.ok(Math.abs(s.owed - start.owed - 1400) < 0.02, `obligations rose by ${s.owed - start.owed}`);
    assert.ok(s.available <= start.available + 0.02, "taking $1,000 in and owing $1,400 frees nothing to sweep");
  });
});

test("CR-027: an overpayment becomes a refundable client credit and isn't sweepable; a duplicate id applies once", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    await onNewCarrier(c, p.id);
    const me = { ...ME, id: p.producerId };
    const start = await sweepable(c);
    const ar = async () => Number((await one<{ b: string }>("SELECT coalesce(sum(debit - credit), 0)::text AS b FROM ledger_entries WHERE client_id = $1 AND account = 'premium_receivable'", [p.clientId], c))!.b);
    const ar0 = await ar();
    const inv = await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, 300, c) }, "test", c);
    const r = await createReceipt({ clientId: p.clientId, amount: 1000, method: "check", applyTo: [inv, inv] }, me, c);
    assert.equal(await invoiceBalance(inv, c), 0);
    assert.equal(Number((await one<{ a: string }>("SELECT sum(amount)::text AS a FROM receipt_applications WHERE invoice_id = $1", [inv], c))!.a), 300);
    const credit = (await one<{ id: number; total: string }>("SELECT id, total FROM invoices WHERE source_receipt_id = $1", [r], c))!;
    assert.equal(Number(credit.total), -700);
    assert.ok(Math.abs((await ar()) - ar0 - (await invoiceBalance(credit.id, c))) < 0.01, "receivables move with the invoices' balances");
    const s = await sweepable(c);
    assert.ok(Math.abs(s.credits - start.credits - 700) < 0.02);
    assert.ok(s.available - start.available <= 30.02, "only the $30 commission became sweepable");
  });
});

test("CR-031: a cancelled policy, or a date outside the term, can't be endorsed", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const me = { ...ME, id: p.producerId };
    const e = { effectiveDate: "2031-06-01", description: "x", premiumChange: 0, issueNow: false };
    await c.query("SAVEPOINT s");
    await assert.rejects(endorsePolicy(p.id, { ...e, effectiveDate: "2040-01-01" }, me, c), /within the term/);
    await c.query("ROLLBACK TO s");
    assert.ok(await endorsePolicy(p.id, e, me, c));
    await c.query("UPDATE policies SET status = 'cancelled' WHERE id = $1", [p.id]);
    await c.query("SAVEPOINT s2");
    await assert.rejects(endorsePolicy(p.id, e, me, c), /in force/);
    await c.query("ROLLBACK TO s2");
  });
});

test("CR-028: relinking an email moves its attachments and drops a policy that isn't the new client's", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const other = (await one<{ id: number }>("SELECT id FROM clients WHERE id <> $1 ORDER BY id LIMIT 1", [p.clientId], c))!.id;
    const email = (await one<{ id: number }>(
      "INSERT INTO emails (message_id, from_addr, to_addrs, subject, body_text, received_at, client_id, policy_id, status, source) VALUES ($1,'x@x.example','{}','s','t',now(),$2,$3,'new','test') RETURNING id",
      [`<t-${crypto.randomUUID()}>`, p.clientId, p.id], c))!.id;
    const doc = (await one<{ id: number }>("INSERT INTO documents (client_id, policy_id, email_id, folder, title, filename, mime, size) VALUES ($1,$2,$3,'Email','a','a.pdf','application/pdf',1) RETURNING id", [p.clientId, p.id, email], c))!.id;
    await relinkEmail(email, other, p.id, c);
    const d = (await one<{ client_id: number; policy_id: number | null }>("SELECT client_id, policy_id FROM documents WHERE id = $1", [doc], c))!;
    assert.equal(d.client_id, other);
    assert.equal(d.policy_id, null);
    const e = (await one<{ client_id: number; policy_id: number | null }>("SELECT client_id, policy_id FROM emails WHERE id = $1", [email], c))!;
    assert.equal(e.client_id, other);
    assert.equal(e.policy_id, null);
  });
});

test("CR-030: a task with no owner reaches Team priorities", async (t) => {
  if (!up) return t.skip("no database");
  const rows = await teamQueue("2099-01-01", 100_000);
  assert.ok(Array.isArray(rows));
  for (const r of rows) if (!r.owner_id) assert.equal(r.owner_name, "Unassigned");
});

test("UAT-F6: re-running the match leaves an accepted variance and a closed line alone", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const st = (await one<{ id: number }>("INSERT INTO commission_statements (carrier_id, statement_date, period, source) VALUES ($1, current_date, 'test', 'manual') RETURNING id", [p.carrierId], c))!.id;
    const line = async () => (await one<{ id: number }>("INSERT INTO commission_lines (statement_id, policy_number, transaction_kind, premium, commission, match_status) VALUES ($1,$2,'new',1000,140,'matched') RETURNING id", [st, p.number], c))!.id;
    const accepted = await line(), closed = await line(), plain = await line();
    await c.query("UPDATE commission_lines SET variance_accepted = true WHERE id = $1", [accepted]);
    await c.query("UPDATE commission_lines SET match_status = 'closed' WHERE id = $1", [closed]);
    await matchCommissionLines(st, c);
    const status = async (id: number) => (await one<{ match_status: string }>("SELECT match_status FROM commission_lines WHERE id = $1", [id], c))!.match_status;
    assert.equal(await status(accepted), "matched");
    assert.equal(await status(closed), "closed");
    assert.equal(await status(plain), "variance", "a line nobody decided on is still compared");
  });
});

test("CR-037: a credit pays down an invoice with no cash or journal, and the receivable still equals the balances", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const me = { ...ME, id: p.producerId };
    const mk = async (total: number, n: string) => (await one<{ id: number }>("INSERT INTO invoices (invoice_number, client_id, issue_date, due_date, total, status) VALUES ($1,$2,current_date,current_date,$3,'open') RETURNING id", [n, p.clientId, total], c))!.id;
    const tag = crypto.randomUUID().slice(0, 8);
    const debit = await mk(1000, `T-D-${tag}`), credit = await mk(-700, `T-C-${tag}`), other = await mk(-5, `T-O-${tag}`);
    const ledger = await one<{ n: number }>("SELECT count(*)::int AS n FROM ledger_entries", [], c);
    const before = await balances(undefined, c);
    const creditsBefore = (await sweepable(c)).credits;

    await assert.rejects(applyCredit(credit, debit, 800, me, c), /Only 700.00 of this credit is left/);
    await assert.rejects(applyCredit(debit, credit, 10, me, c), /isn't open/);
    await applyCredit(credit, debit, null, me, c);
    assert.equal(await invoiceBalance(debit, c), 300);
    assert.equal(await invoiceBalance(credit, c), 0);
    const status = async (id: number) => (await one<{ status: string }>("SELECT status FROM invoices WHERE id = $1", [id], c))!.status;
    assert.equal(await status(debit), "partial");
    assert.equal(await status(credit), "paid");
    assert.equal((await sweepable(c)).credits, Math.round((creditsBefore - 700) * 100) / 100);
    assert.equal((await one<{ n: number }>("SELECT count(*)::int AS n FROM ledger_entries", [], c))!.n, ledger!.n, "no journal");
    assert.deepEqual(await balances(undefined, c), before);

    await assert.rejects(applyCredit(credit, debit, 1, me, c), /That credit isn't open/, "it's used up");
    await applyCredit(other, debit, 5, me, c);
    await createReceipt({ clientId: p.clientId, amount: 295, method: "check", applyTo: [debit] }, me, c);
    assert.equal(await status(debit), "paid");
  });
});

test("CR-039: a cancelled, lost or non-renewed term can't be renewed", async (t) => {
  if (!up) return t.skip("no database");
  const p = await one<{ id: number; status: string }>("SELECT id, status FROM policies WHERE status IN ('cancelled','lost','non_renewed') AND renewal_policy_id IS NULL LIMIT 1");
  if (!p) return t.skip("no such policy in this database");
  await assert.rejects(renewPolicy(p.id, { policyNumber: "X", effectiveDate: "2031-01-01", termMonths: 12, premium: 1, commissionPct: 10, carrierId: 1, billMode: "direct" }, ME), /can't be renewed/);
});

test("CR-044: premium already paid to the carrier can't offset what it's still owed after an NSF", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const carrier = await onNewCarrier(c, p.id);
    const me = { ...ME, id: p.producerId };
    const start = await sweepable(c);
    const paid = async (amount: number) => {
      const inv = await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, amount, c) }, "test", c);
      return createReceipt({ clientId: p.clientId, amount, method: "check", applyTo: [inv] }, me, c);
    };
    const first = await paid(1000);
    await paid(2000);
    await payCarrierStatement(carrier, "T-1", ME, c);
    await paid(5000);                                       // collected, not yet paid: $4,500 is owed
    await reverseReceipt(first, "NSF", ME, c);
    const s = await sweepable(c);
    assert.ok(Math.abs(s.carriers - start.carriers - 4500) < 0.02, `carriers rose by ${s.carriers - start.carriers}`);
  });
});

test("CR-045: voiding a refund posts no negative lines and opens the credit again", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const me = { ...ME, id: p.producerId };
    const credit = await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, -500, c) }, "test", c);
    const before = await balances(undefined, c);
    await refundInvoice(credit, "check", "T-1", me, c, await clientOwed(p.clientId, c));
    const refund = (await one<{ id: number }>("SELECT receipt_id AS id FROM receipt_applications WHERE invoice_id = $1", [credit], c))!.id;
    assert.deepEqual(await reverseReceipt(refund, "", ME, c), { refund: true });
    const lines = (await q<{ debit: string; credit: string }>("SELECT debit, credit FROM ledger_entries WHERE ref_type = 'receipt' AND ref_id = $1", [refund], c));
    assert.equal(lines.length, 4);
    assert.ok(lines.every((l) => Number(l.debit) >= 0 && Number(l.credit) >= 0));
    assert.deepEqual(await balances(undefined, c), before);
    assert.equal(await invoiceBalance(credit, c), -500);
    const r = (await one<{ status: string; reversed_reason: string }>("SELECT status, reversed_reason FROM receipts WHERE id = $1", [refund], c))!;
    assert.deepEqual([r.status, r.reversed_reason], ["reversed", "Refund check voided"]);
  });
});

test("CR-036: automation chases an overdue invoice and never an overdue credit", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const tag = crypto.randomUUID().slice(0, 8);
    const mk = async (total: number, n: string) => (await one<{ id: number }>("INSERT INTO invoices (invoice_number, client_id, issue_date, due_date, total, status) VALUES ($1,$2,'2030-01-01','2030-01-01',$3,'open') RETURNING id", [n, p.clientId, total], c))!.id;
    const debit = await mk(100, `T-D-${tag}`), credit = await mk(-100, `T-C-${tag}`);
    const ids = (await pastDueInvoices("2030-01-20", 10, c)).map((i) => i.id);
    assert.ok(ids.includes(debit));
    assert.ok(!ids.includes(credit));
  });
});

test("CR-038: \"Looks right\" files attachments held at intake on the matched client", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const mk = async (clientId: number | null) => (await one<{ id: number }>(
      "INSERT INTO emails (message_id, from_addr, to_addrs, subject, body_text, received_at, client_id, policy_id, status, source) VALUES ($1,'x@x.example','{}','s','t',now(),$2,$3,'new','test') RETURNING id",
      [`<t-${crypto.randomUUID()}>`, clientId, clientId ? p.id : null], c))!.id;
    const status = async (id: number) => (await one<{ status: string }>("SELECT status FROM emails WHERE id = $1", [id], c))!.status;
    const email = await mk(p.clientId);
    const doc = (await one<{ id: number }>("INSERT INTO documents (email_id, folder, title, filename, mime, size) VALUES ($1,'Email','a','a.pdf','application/pdf',1) RETURNING id", [email], c))!.id;
    assert.equal(await confirmEmailReviewed(email, c), true);
    const d = (await one<{ client_id: number; policy_id: number }>("SELECT client_id, policy_id FROM documents WHERE id = $1", [doc], c))!;
    assert.deepEqual([d.client_id, d.policy_id], [p.clientId, p.id]);
    assert.equal(await status(email), "actioned");
    const clean = await mk(p.clientId);
    assert.equal(await confirmEmailReviewed(clean, c), false);
    assert.equal(await status(clean), "actioned");
  });
});

test("UX-001: a non-pay notice can't be recorded as cancelled before its date, and can from then on", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const status = async () => (await one<{ status: string }>("SELECT status FROM policies WHERE id = $1", [p.id], c))!.status;
    await c.query("UPDATE policies SET status = 'pending_cancel', cancel_date = current_date + 5, cancel_reason = 'Non-payment' WHERE id = $1", [p.id]);
    await assert.rejects(confirmNonpayCancellation(p.id, ME, c), /doesn't take effect until/);
    assert.equal(await status(), "pending_cancel");
    await c.query("UPDATE policies SET cancel_date = current_date WHERE id = $1", [p.id]);
    await confirmNonpayCancellation(p.id, ME, c);
    assert.equal(await status(), "cancelled");
  });
});

test("CR-053: a voided credit can't be refunded, and a refund while the client owes needs the owed amount confirmed", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const p = await newPolicy(c);
    const me = { ...ME, id: p.producerId };
    const trust = async () => Number((await one<{ v: string }>("SELECT coalesce(sum(debit - credit),0)::text AS v FROM ledger_entries WHERE account = 'trust_cash'", [], c))!.v);
    const voided = await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, -200, c) }, "test", c);
    assert.ok(await voidCredit(voided, "test", "test", c));
    const before = await trust();
    await assert.rejects(refundInvoice(voided, "check", null, me, c, await clientOwed(p.clientId, c)), /voided/);
    assert.equal(await trust(), before);

    await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, 1000, c) }, "test", c);
    const owed = await clientOwed(p.clientId, c);
    assert.ok(owed >= 1000, `owed ${owed}`);
    const credit = await createInvoice({ clientId: p.clientId, policyId: p.id, lines: await invoiceLinesFor(p.id, -500, c) }, "test", c);
    await assert.rejects(refundInvoice(credit, "check", null, me, c), /still owes/);
    await assert.rejects(refundInvoice(credit, "check", null, me, c, owed - 100), /still owes/, "a stale amount is refused");
    assert.equal(await trust(), before);
    await refundInvoice(credit, "check", null, me, c, owed);
    assert.ok(Math.abs(await trust() - (before - 500)) < 0.005);
    await assert.rejects(refundInvoice(credit, "check", null, me, c, owed), /already been refunded/);
  });
});
