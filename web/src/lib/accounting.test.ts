// Ledger integrity against the local database (docker compose up -d db; npm run seed).
// Skipped when the database is unreachable. Writes happen inside a transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { db, one } from "./db";
import { post } from "./accounting";

let up = false;
before(async () => { try { await db.query("SELECT 1 FROM ledger_entries LIMIT 1"); up = true; } catch { up = false; } });
after(async () => { await db.end(); });

test("an unbalanced journal is refused before anything is written", async (t) => {
  if (!up) return t.skip("no database");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const before = await one<{ n: number }>("SELECT count(*)::int AS n FROM ledger_entries", [], c);
    await assert.rejects(post({ date: "2026-10-30", memo: "test", refType: "test", refId: 0 },
      [{ account: "trust_cash", debit: 100 }, { account: "premium_receivable", credit: 99.99 }], c), /Unbalanced/);
    const journal = await post({ date: "2026-10-30", memo: "test", refType: "test", refId: 0 },
      [{ account: "trust_cash", debit: 100.004 }, { account: "premium_receivable", credit: 100 }], c);
    const after = await one<{ n: number; bal: string }>("SELECT count(*)::int AS n, sum(debit - credit)::text AS bal FROM ledger_entries WHERE journal = $1", [journal], c);
    assert.equal(after!.n, 2);
    assert.equal(Number(after!.bal), 0, "amounts round to cents before balancing");
    assert.ok(before);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});

test("a locked period refuses postings", async (t) => {
  if (!up) return t.skip("no database");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("INSERT INTO accounting_periods (period, locked) VALUES ('2026-01', true) ON CONFLICT (period) DO UPDATE SET locked = true");
    await assert.rejects(post({ date: "2026-01-15", memo: "late", refType: "test", refId: 0 },
      [{ account: "trust_cash", debit: 1 }, { account: "premium_receivable", credit: 1 }], c), /locked/);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
});

test("every journal in the ledger balances", async (t) => {
  if (!up) return t.skip("no database");
  const r = await one<{ n: number }>("SELECT count(*)::int AS n FROM (SELECT journal FROM ledger_entries GROUP BY journal HAVING round(sum(debit) - sum(credit), 2) <> 0) x");
  assert.equal(r!.n, 0);
});

test("premium receivable equals the open balance of invoices", async (t) => {
  if (!up) return t.skip("no database");
  const r = await one<{ ledger: string; invoices: string }>(`
    SELECT (SELECT coalesce(sum(debit - credit), 0) FROM ledger_entries WHERE account = 'premium_receivable')::numeric(14,2)::text AS ledger,
           (SELECT coalesce(sum(i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id
                                                    WHERE ra.invoice_id = i.id AND r.status <> 'reversed'), 0)), 0)
              FROM invoices i WHERE i.status <> 'void')::numeric(14,2)::text AS invoices`);
  assert.equal(r!.ledger, r!.invoices);
});

test("trust cash covers what the agency owes carriers and taxing authorities", async (t) => {
  if (!up) return t.skip("no database");
  const { sweepable } = await import("./accounting");
  const s = await sweepable();
  assert.ok(s.trust >= s.owed - 0.01, `trust ${s.trust} < owed ${s.owed}`);
});
