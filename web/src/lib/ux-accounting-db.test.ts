// The receipt confirmation's wording and a producer's own reports (UX-029, UX-034). The database cases run against
// the local database and are skipped when it is unreachable; everything happens in a transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { createReceipt, postCommissionStatement } from "./accounting";
import { db, one, q } from "./db";
import { myProductionBy, myProductionMonthly, myStatementLines, myStatements } from "./producer-reports";
import { fullBalance, parseAmount, receiptConfirm } from "./receipt-confirm";

let up = false;
before(async () => { try { await db.query("SELECT 1 FROM producer_statements LIMIT 1"); up = true; } catch { up = false; } });
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

const OPEN = [{ id: 1, number: "INV-1", balance: 100 }, { id: 2, number: "INV-2", balance: 200 }, { id: 3, number: "INV-3", balance: 50 }];
const ask = (amount: number, ticked: number[] = []) => receiptConfirm({ amount, method: "check", reference: "10442", client: "Brown Electric", invoices: OPEN, ticked });

test("the confirmation names the amount, reference, client and only the invoices the money reaches", () => {
  assert.equal(ask(150), "Post $150.00 check #10442 from Brown Electric to trust, applied oldest first to INV-1 and INV-2?");
  assert.equal(ask(100), "Post $100.00 check #10442 from Brown Electric to trust, applied to INV-1?");
  assert.equal(ask(350), "Post $350.00 check #10442 from Brown Electric to trust, applied oldest first to INV-1, INV-2 and INV-3?");
});

test("the confirmation follows the ticks and says when money becomes a credit", () => {
  assert.equal(ask(50, [2]), "Post $50.00 check #10442 from Brown Electric to trust, applied to INV-2?");
  assert.equal(ask(260, [2, 3]), "Post $260.00 check #10442 from Brown Electric to trust, applied oldest first to INV-2 and INV-3? The $10.00 over what's owed becomes a credit on the account.");
  assert.match(receiptConfirm({ amount: 5, method: "ach", client: "X", invoices: [], ticked: [] }), /^Post \$5\.00 ACH from X to trust\? Nothing is open .* credit/);
});

test("the amount reads as the server reads it, and full balance honors the ticks", () => {
  assert.equal(parseAmount("$2,500.00"), 2500);
  assert.equal(parseAmount("abc"), 0);
  assert.equal(parseAmount(""), 0);
  assert.equal(fullBalance(OPEN, []), 350);
  assert.equal(fullBalance(OPEN, [1, 3]), 150);
});

test("the confirmation names the same invoices createReceipt pays", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const client = (await one<{ id: number }>("SELECT id FROM clients WHERE kind = 'business' ORDER BY id LIMIT 1", [], c))!;
    const user = (await one<{ id: number }>("SELECT id FROM users ORDER BY id LIMIT 1", [], c))!;
    const made = [];
    for (const n of [1, 2, 3]) made.push((await one<{ id: number }>("INSERT INTO invoices (invoice_number, client_id, issue_date, due_date, total, status) VALUES ($1,$2,'2031-01-01',$3,100,'open') RETURNING id", [`UX-${n}-${crypto.randomUUID().slice(0, 6)}`, client.id, `2031-01-0${n}`], c))!.id);
    await c.query("UPDATE invoices SET status = 'paid' WHERE client_id = $1 AND NOT (id = ANY($2))", [client.id, made]);
    const invoices = made.map((id, i) => ({ id, number: `N${i}`, balance: 100 }));
    assert.match(receiptConfirm({ amount: 150, method: "check", client: "X", invoices, ticked: [] }), /to N0 and N1\?$/);
    const id = await createReceipt({ clientId: client.id, amount: 150, method: "check", date: "2031-01-05" }, { id: user.id, username: "test" }, c);
    const applied = await q<{ invoice_id: number }>("SELECT invoice_id FROM receipt_applications WHERE receipt_id = $1 ORDER BY invoice_id", [id], c);
    assert.deepEqual(applied.map((a) => a.invoice_id), made.slice(0, 2));
  });
});

test("a producer's production holds only their own policies", async (t) => {
  if (!up) return t.skip("no database");
  const r = { from: "2000-01-01", to: "2100-01-01" };
  const [a, b] = await q<{ id: number; total: string }>("SELECT producer_id AS id, sum(premium)::text AS total FROM policies WHERE producer_id IS NOT NULL AND status <> 'quote' GROUP BY 1 HAVING sum(premium) > 0 ORDER BY 1 LIMIT 2");
  if (!b) return t.skip("needs two producers with policies");
  const monthly = (rows: Awaited<ReturnType<typeof myProductionMonthly>>) => rows.reduce((s, m) => s + Number(m.new_premium) + Number(m.renewal_premium), 0);
  const near = (x: number, y: string) => assert.ok(Math.abs(x - Number(y)) < 0.01, `${x} vs ${y}`);
  near(monthly(await myProductionMonthly(a.id, r)), a.total);
  near(monthly(await myProductionMonthly(b.id, r)), b.total);
  near((await myProductionBy("carrier", a.id, r)).reduce((s, x) => s + Number(x.total_premium), 0), a.total);
  near((await myProductionBy("lob", b.id, r)).reduce((s, x) => s + Number(x.total_premium), 0), b.total);
  assert.deepEqual(await myProductionMonthly(0, r), []);
});

test("a producer sees only their own statements, and another's lines come back empty", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const [a, b] = await q<{ id: number; policy: number }>("SELECT producer_id AS id, min(id) AS policy FROM policies WHERE producer_id IS NOT NULL GROUP BY 1 ORDER BY 1 LIMIT 2", [], c);
    if (!b) return t.skip("needs two producers with policies");
    const statement = async (u: typeof a) => {
      const s = (await one<{ id: number }>("INSERT INTO producer_statements (user_id, period, total) VALUES ($1,'2099-01',10) RETURNING id", [u.id], c))!;
      await c.query("INSERT INTO producer_statement_lines (statement_id, policy_id, kind, agency_commission, split_pct, amount) VALUES ($1,$2,'new',100,10,10)", [s.id, u.policy]);
      return s.id;
    };
    const mine = await statement(a), theirs = await statement(b);
    const list = (await myStatements(a.id, c)).map((s) => s.id);
    assert.ok(list.includes(mine));
    assert.ok(!list.includes(theirs));
    assert.equal((await myStatementLines(a.id, mine, c)).length, 1);
    assert.deepEqual(await myStatementLines(a.id, theirs, c), []);
  });
});

test("UX-012: the Post button only hides what the server refuses by itself: unmatched lines, no deposit, a wrong deposit", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const carrier = (await one<{ id: number }>("SELECT id FROM carriers WHERE kind = 'carrier' AND active ORDER BY id LIMIT 1", [], c))!.id;
    const st = (await one<{ id: number }>("INSERT INTO commission_statements (carrier_id, statement_date, period, source) VALUES ($1, current_date, 'test', 'manual') RETURNING id", [carrier], c))!.id;
    const line = (await one<{ id: number }>("INSERT INTO commission_lines (statement_id, policy_number, transaction_kind, premium, commission, match_status) VALUES ($1,'X','new',1000,140,'unmatched') RETURNING id", [st], c))!.id;
    const me = { username: "test" };
    await assert.rejects(postCommissionStatement(st, me, c), /1 line\(s\) are still unmatched/);
    await c.query("UPDATE commission_lines SET match_status = 'matched' WHERE id = $1", [line]);
    await assert.rejects(postCommissionStatement(st, me, c), /Record the carrier's deposit/);
    await c.query("UPDATE commission_statements SET deposit_amount = 1, deposit_date = current_date WHERE id = $1", [st]);
    await assert.rejects(postCommissionStatement(st, me, c), /doesn't equal the statement lines/);
    await c.query("UPDATE commission_statements SET deposit_amount = 140 WHERE id = $1", [st]);
    await postCommissionStatement(st, me, c);
    assert.equal((await one<{ status: string }>("SELECT status FROM commission_statements WHERE id = $1", [st], c))!.status, "posted");
  });
});
