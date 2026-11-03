import { test, expect, sql, val } from "./fixtures";

// After everything above has moved money: the books must still balance. Runs last by file order.
test("the ledger balances: overall, and per journal", async () => {
  const [d, c] = sql("select sum(debit), sum(credit) from ledger_entries")[0];
  expect(Number(d)).toBeGreaterThan(0);
  expect(Number(d), "total debits equal total credits").toBeCloseTo(Number(c), 2);
  const off = sql("select journal, sum(debit), sum(credit) from ledger_entries group by journal having abs(sum(debit) - sum(credit)) > 0.004");
  expect(off, "every journal balances").toEqual([]);
});

test("every open client balance on an invoice agrees with the receivable in the ledger", async () => {
  const ledger = Number(val("select sum(debit - credit) from ledger_entries where account = 'premium_receivable'"));
  // Money on a receipt beyond its applications reduces the receivable without touching an invoice, so it's counted too,
  // unless it became a client credit, which is an invoice row already in the sum above.
  const invoices = Number(val(`select sum(i.total - coalesce((select sum(ra.amount) from receipt_applications ra join receipts r on r.id = ra.receipt_id where ra.invoice_id = i.id and r.status = 'finalized'), 0)) from invoices i where i.status <> 'void'`));
  const unapplied = Number(val(`select coalesce(sum(r.amount - coalesce((select sum(ra.amount) from receipt_applications ra where ra.receipt_id = r.id), 0) + coalesce((select sum(i.total) from invoices i where i.source_receipt_id = r.id and i.status <> 'void'), 0)), 0) from receipts r where r.status = 'finalized'`));
  expect(ledger).toBeCloseTo(invoices - unapplied, 2);
});
