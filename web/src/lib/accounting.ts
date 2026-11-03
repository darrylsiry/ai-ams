import { audit } from "./audit";
import { db, nextNumber, one, q, tx, type Queryable } from "./db";
import { addDays, todayISO } from "./format";
import { DEFAULTS, getSetting } from "./settings";
import type { User } from "./user";

// Insurance sub-ledger (BIL, CSH, GL-04..34, COM-11..24). Every money event posts a balanced
// journal to ledger_entries; balances, the trust statement (GL-25) and the GL export (GL-17) are
// derived from it. The general ledger itself stays in QuickBooks or similar for the MVP.

export type Account =
  | "trust_cash" | "operating_cash" | "premium_receivable" | "carrier_payable" | "commission_income"
  | "commission_receivable" | "producer_payable" | "producer_expense" | "tax_payable" | "fee_income" | "refunds_payable";

export const ACCOUNT_LABEL: Record<Account, string> = {
  trust_cash: "Premium trust cash", operating_cash: "Operating cash", premium_receivable: "Premium receivable",
  carrier_payable: "Carrier payable", commission_income: "Commission income", commission_receivable: "Commission receivable",
  producer_payable: "Producer commission payable", producer_expense: "Producer commission expense", tax_payable: "Surplus lines tax payable",
  fee_income: "Agency fee income", refunds_payable: "Client refunds payable",
};

export type Line = { account: Account; debit?: number; credit?: number };
export type JournalRef = { date: string; memo: string; refType: string; refId: number; clientId?: number | null; policyId?: number | null; carrierId?: number | null };

const round = (n: number) => Math.round(n * 100) / 100;

/** Post one balanced journal. Throws when debits and credits differ or the period is locked. */
export async function post(ref: JournalRef, lines: Line[], on: Queryable = db): Promise<string> {
  // A negative amount is the other side of the entry: the ledger only ever holds positive debits and credits (CR-051).
  const lines2 = lines.map((l) => { const net = round((l.debit ?? 0) - (l.credit ?? 0)); return { ...l, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 }; }).filter((l) => l.debit || l.credit);
  const dr = round(lines2.reduce((s, l) => s + l.debit, 0)), cr = round(lines2.reduce((s, l) => s + l.credit, 0));
  if (dr !== cr) throw new Error(`Unbalanced journal (${ref.memo}): debits ${dr} ≠ credits ${cr}`);
  const locked = await one("SELECT 1 FROM accounting_periods WHERE period = $1 AND locked", [ref.date.slice(0, 7)], on);
  if (locked) throw new Error(`Accounting period ${ref.date.slice(0, 7)} is locked.`);
  const journal = `J-${ref.refType}-${ref.refId}-${crypto.randomUUID()}`;   // CR-015: unique even for two journals in one millisecond
  for (const l of lines2) {
    await on.query(
      `INSERT INTO ledger_entries (entry_date, journal, account, debit, credit, memo, ref_type, ref_id, client_id, policy_id, carrier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [ref.date, journal, l.account, l.debit, l.credit, ref.memo, ref.refType, ref.refId, ref.clientId ?? null, ref.policyId ?? null, ref.carrierId ?? null]);
  }
  return journal;
}

// ───────────────────────── Invoices (BIL-01, 05..17)

export type InvoiceLineInput = {
  kind: "premium" | "return_premium" | "policy_fee" | "agency_fee" | "broker_fee" | "surplus_lines_tax" | "stamping_fee";
  description: string; amount: number; commissionPct?: number;
};

/** Lines for an agency-bill premium change: premium (with commission), plus surplus lines tax and stamping fee for non-admitted policies. */
export async function invoiceLinesFor(policyId: number, premium: number, on: Queryable = db): Promise<InvoiceLineInput[]> {
  const p = await one<{ commission_pct: string; is_admitted: boolean; state: string | null; lob: string }>(
    "SELECT p.commission_pct, p.is_admitted, c.state, p.lob FROM policies p JOIN clients c ON c.id = p.client_id WHERE p.id = $1", [policyId], on);
  if (!p) throw new Error("Policy not found");
  const lines: InvoiceLineInput[] = [{
    kind: premium >= 0 ? "premium" : "return_premium", description: premium >= 0 ? "Premium" : "Return premium",
    amount: premium, commissionPct: Number(p.commission_pct),
  }];
  if (!p.is_admitted && p.state) {
    const rates = await q<{ kind: string; rate_pct: string }>("SELECT kind, rate_pct FROM tax_rates WHERE state = $1", [p.state], on);
    for (const r of rates) {
      const amt = round((premium * Number(r.rate_pct)) / 100);
      if (amt) lines.push({ kind: r.kind as InvoiceLineInput["kind"], description: `${p.state} ${r.kind === "surplus_lines_tax" ? "surplus lines tax" : "stamping fee"} (${Number(r.rate_pct)}%)`, amount: amt });
    }
  }
  return lines;
}

/** Create and post an invoice. Returns its id. */
export async function createInvoice(
  input: { clientId: number; policyId: number | null; transactionId?: number | null; issueDate?: string; dueDays?: number; memo?: string; lines: InvoiceLineInput[] },
  actor: string, on?: Queryable,
): Promise<number> {
  // A fee owed to a carrier with no policy names no carrier, so nothing could ever pay it (CR-019).
  if (!input.policyId && input.lines.some((l) => l.kind === "policy_fee")) throw new Error("A carrier policy fee needs a policy.");
  const run = async (c: Queryable) => {
    const issue = input.issueDate ?? todayISO();
    const carrier = input.policyId ? await one<{ carrier_id: number; wholesaler_id: number | null }>(
      "SELECT carrier_id, wholesaler_id FROM policies WHERE id = $1", [input.policyId], c) : null;
    const payee = carrier ? (carrier.wholesaler_id ?? carrier.carrier_id) : null;
    const total = round(input.lines.reduce((s, l) => s + l.amount, 0));
    const number = await nextNumber("INV", c);
    const inv = await one<{ id: number }>(
      `INSERT INTO invoices (invoice_number, client_id, policy_id, transaction_id, issue_date, due_date, total, memo, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [number, input.clientId, input.policyId, input.transactionId ?? null, issue, addDays(issue, input.dueDays ?? 20), total, input.memo ?? null,
        total === 0 ? "paid" : "open"], c);   // a credit (return premium) stays open until the refund is paid
    const journal: Line[] = [];
    for (const l of input.lines) {
      const isPremium = l.kind === "premium" || l.kind === "return_premium";
      const commission = isPremium ? round((l.amount * (l.commissionPct ?? 0)) / 100) : 0;
      const payable = isPremium ? round(l.amount - commission) : l.kind === "policy_fee" ? l.amount : 0;
      const payTo = isPremium || l.kind === "policy_fee" ? "carrier" : l.kind.endsWith("_tax") || l.kind === "stamping_fee" ? "state" : "agency";
      await c.query(
        `INSERT INTO invoice_lines (invoice_id, kind, description, amount, commission_pct, commission_amount, payable_amount, payable_to, carrier_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [inv!.id, l.kind, l.description, l.amount, l.commissionPct ?? 0, commission, payable, payTo, payTo === "carrier" ? payee : null]);
      const sign = l.amount >= 0 ? 1 : -1, a = Math.abs(l.amount);
      const dr = (acct: Account, v: number) => journal.push(sign > 0 ? { account: acct, debit: v } : { account: acct, credit: v });
      const cr = (acct: Account, v: number) => journal.push(sign > 0 ? { account: acct, credit: v } : { account: acct, debit: v });
      dr("premium_receivable", a);
      if (isPremium) { cr("carrier_payable", Math.abs(payable)); cr("commission_income", Math.abs(commission)); }
      else if (l.kind === "policy_fee") cr("carrier_payable", a);
      else if (payTo === "state") cr("tax_payable", a);
      else cr("fee_income", a);
    }
    await post({ date: issue, memo: `Invoice ${number}`, refType: "invoice", refId: inv!.id, clientId: input.clientId, policyId: input.policyId, carrierId: payee }, journal, c);
    await audit({ actor, action: "invoice.created", entityType: "invoice", entityId: inv!.id, summary: `Invoice ${number} for $${total.toFixed(2)}` }, c);
    return inv!.id;
  };
  return on ? run(on) : tx(run);
}

export async function invoiceBalance(invoiceId: number, on: Queryable = db): Promise<number> {
  const r = await one<{ bal: string }>(
    `SELECT (i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id
                                 WHERE ra.invoice_id = i.id AND r.status = 'finalized'),0))::text AS bal FROM invoices i WHERE i.id = $1`, [invoiceId], on);
  return Number(r?.bal ?? 0);
}

async function refreshInvoiceStatus(invoiceId: number, on: Queryable) {
  const bal = await invoiceBalance(invoiceId, on);
  const inv = await one<{ total: string; status: string }>("SELECT total, status FROM invoices WHERE id = $1", [invoiceId], on);
  if (!inv || inv.status === "void") return;
  const status = Number(inv.total) < 0 ? (bal >= -0.004 ? "paid" : "open") : bal <= 0.004 ? "paid" : bal < Number(inv.total) ? "partial" : "open";
  await on.query("UPDATE invoices SET status = $2 WHERE id = $1", [invoiceId, status]);
}

/**
 * Take back a client credit nobody has refunded, when the cancellation behind it is undone (CR-011).
 * Reverses the invoice's own journal, so the ledger still balances. Returns false when any of it has
 * been refunded or settled with the carrier: that money has moved, and needs a new invoice instead.
 */
export async function voidCredit(invoiceId: number, reason: string, actor: string, c: Queryable): Promise<boolean> {
  const inv = await one<{ total: string; status: string; invoice_number: string; client_id: number; policy_id: number | null }>("SELECT total, status, invoice_number, client_id, policy_id FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId], c);
  if (!inv || inv.status === "void") return true;
  const settled = await one<{ n: number }>("SELECT count(*)::int AS n FROM invoice_lines WHERE invoice_id = $1 AND carrier_statement_id IS NOT NULL", [invoiceId], c);
  if (settled!.n || Math.abs((await invoiceBalance(invoiceId, c)) - Number(inv.total)) > 0.004) return false;
  const rows = await q<{ account: Account; debit: string; credit: string; carrier_id: number | null }>("SELECT account, debit, credit, carrier_id FROM ledger_entries WHERE ref_type = 'invoice' AND ref_id = $1", [invoiceId], c);
  await post({ date: todayISO(), memo: `Void ${inv.invoice_number}: ${reason}`, refType: "invoice", refId: invoiceId, clientId: inv.client_id, policyId: inv.policy_id, carrierId: rows[0]?.carrier_id ?? null },
    rows.map((r) => ({ account: r.account, debit: Number(r.credit), credit: Number(r.debit) })), c);
  await c.query("UPDATE invoices SET status = 'void' WHERE id = $1", [invoiceId]);
  await audit({ actor, action: "invoice.voided", entityType: "invoice", entityId: invoiceId, summary: `Voided ${inv.invoice_number}: ${reason}` }, c);
  return true;
}

// ───────────────────────── Receipts (CSH-01..17)

/**
 * Record a client payment into trust and apply it to the given invoices, or every open one oldest
 * first. Balances are read with the invoices locked, inside this transaction, so an application can
 * never exceed what an invoice owes or what was received (CR-013).
 */
export async function createReceipt(
  input: { clientId: number; amount: number; method: string; reference?: string; date?: string; memo?: string; applyTo?: number[] },
  user: Pick<User, "id" | "username">, on?: Queryable,
): Promise<number> {
  const run = async (c: Queryable) => {
    const date = input.date ?? todayISO();
    const number = await nextNumber("RCPT", c);
    const r = await one<{ id: number }>(
      `INSERT INTO receipts (receipt_number, client_id, received_date, amount, method, reference, memo, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [number, input.clientId, date, input.amount, input.method, input.reference ?? null, input.memo ?? null, user.id], c);
    let remaining = round(input.amount);
    const plan: { invoiceId: number; amount: number }[] = [];
    const open = await q<{ id: number }>(
      `SELECT id FROM invoices WHERE client_id = $1 AND status IN ('open','partial') ${input.applyTo ? "AND id = ANY($2)" : ""} ORDER BY due_date, id FOR UPDATE`,
      input.applyTo ? [input.clientId, input.applyTo] : [input.clientId], c);
    if (input.applyTo && open.length !== new Set(input.applyTo).size) throw new Error("One of those invoices isn't open on this client's account.");
    const inOrder = input.applyTo ? [...new Set(input.applyTo)].map((id) => ({ id })) : open;
    for (const inv of inOrder) {
      if (remaining <= 0) break;
      const bal = await invoiceBalance(inv.id, c);
      const amt = round(Math.min(bal, remaining));
      if (amt > 0) { plan.push({ invoiceId: inv.id, amount: amt }); remaining = round(remaining - amt); }
    }
    for (const a of plan) {
      await c.query("INSERT INTO receipt_applications (receipt_id, invoice_id, amount) VALUES ($1,$2,$3)", [r!.id, a.invoiceId, a.amount]);
      await refreshInvoiceStatus(a.invoiceId, c);
    }
    // Money beyond what is owed stays the client's: a credit they can be refunded, counted as owed in the trust (CR-027).
    // The receipt's journal already credited receivables with all of it, so the credit posts nothing of its own.
    if (remaining > 0) {
      await c.query(
        `INSERT INTO invoices (invoice_number, client_id, issue_date, due_date, total, memo, status, source_receipt_id) VALUES ($1,$2,$3,$3,$4,$5,'open',$6)`,
        [await nextNumber("CRD", c), input.clientId, date, -remaining, `Overpayment on ${number}`, r!.id]);
    }
    await post({ date, memo: `Receipt ${number} (${input.method}${input.reference ? ` ${input.reference}` : ""})`, refType: "receipt", refId: r!.id, clientId: input.clientId },
      [{ account: "trust_cash", debit: input.amount }, { account: "premium_receivable", credit: input.amount }], c);
    await audit({ actor: user.username, action: "receipt.created", entityType: "receipt", entityId: r!.id, summary: `Receipt ${number} $${input.amount.toFixed(2)}` }, c);
    return r!.id;
  };
  return on ? run(on) : tx(run);
}

/** Client refund (CSH-17): pay a credit balance (return premium) from trust by check or ACH. */
export async function refundInvoice(invoiceId: number, method: string, reference: string | null, user: Pick<User, "id" | "username">, on?: Queryable) {
  const run = async (c: Queryable) => {
    const inv = await one<{ id: number; client_id: number; policy_id: number | null; invoice_number: string; total: string }>("SELECT * FROM invoices WHERE id = $1 FOR UPDATE", [invoiceId], c);
    if (!inv || Number(inv.total) >= 0) throw new Error("Only a credit can be refunded.");
    const bal = await invoiceBalance(invoiceId, c);
    if (bal >= -0.004) throw new Error("This credit has already been refunded.");
    const amount = round(-bal);
    const date = todayISO();
    const number = await nextNumber("RFND", c);
    const r = await one<{ id: number }>(
      `INSERT INTO receipts (receipt_number, client_id, received_date, amount, method, reference, memo, created_by_id) VALUES ($1,$2,$3,$4,$5,$6,'Refund to client',$7) RETURNING id`,
      [number, inv.client_id, date, -amount, method, reference, user.id], c);
    await c.query("INSERT INTO receipt_applications (receipt_id, invoice_id, amount) VALUES ($1,$2,$3)", [r!.id, invoiceId, -amount]);
    await refreshInvoiceStatus(invoiceId, c);
    await post({ date, memo: `Refund ${number} for ${inv.invoice_number}`, refType: "receipt", refId: r!.id, clientId: inv.client_id, policyId: inv.policy_id },
      [{ account: "premium_receivable", debit: amount }, { account: "trust_cash", credit: amount }], c);
    await audit({ actor: user.username, action: "refund.paid", entityType: "invoice", entityId: invoiceId, summary: `Refunded $${amount.toFixed(2)} (${method}${reference ? ` ${reference}` : ""})` }, c);
  };
  await (on ? run(on) : tx(run));
}

/**
 * Use a client credit against an open invoice (BIL-23). Both sit in premium receivable, so this moves no
 * cash and posts no journal: a zero-amount receipt holds the pair of applications, and reversing it undoes them.
 * A blank amount applies as much as both can take.
 */
export async function applyCredit(creditId: number, invoiceId: number, amount: number | null, user: Pick<User, "id" | "username">, on?: Queryable): Promise<number> {
  const run = async (c: Queryable) => {
    const rows = await q<{ id: number; client_id: number; total: string; status: string; invoice_number: string }>(
      "SELECT id, client_id, total, status, invoice_number FROM invoices WHERE id = ANY($1) ORDER BY id FOR UPDATE", [[creditId, invoiceId]], c);
    const credit = rows.find((r) => r.id === creditId), debit = rows.find((r) => r.id === invoiceId);
    if (!credit || Number(credit.total) >= 0 || credit.status !== "open") throw new Error("That credit isn't open.");
    if (!debit || Number(debit.total) <= 0 || !["open", "partial"].includes(debit.status)) throw new Error("That invoice isn't open.");
    if (credit.client_id !== debit.client_id) throw new Error("A credit can only be applied to the same client's invoice.");
    const available = round(-(await invoiceBalance(creditId, c))), owed = round(await invoiceBalance(invoiceId, c));
    const applied = amount === null ? round(Math.min(available, owed)) : round(amount);
    if (applied <= 0) throw new Error("Enter an amount above zero.");
    if (applied > available) throw new Error(`Only ${available.toFixed(2)} of this credit is left.`);
    if (applied > owed) throw new Error(`Only ${owed.toFixed(2)} is owed on ${debit.invoice_number}.`);
    const date = todayISO();
    const number = await nextNumber("CAPP", c);
    const memo = `Credit ${credit.invoice_number} applied to ${debit.invoice_number}`;
    const r = await one<{ id: number }>(
      `INSERT INTO receipts (receipt_number, client_id, received_date, amount, method, memo, created_by_id) VALUES ($1,$2,$3,0,'credit',$4,$5) RETURNING id`,
      [number, credit.client_id, date, memo, user.id], c);
    await c.query("INSERT INTO receipt_applications (receipt_id, invoice_id, amount) VALUES ($1,$2,$3), ($1,$4,$5)", [r!.id, invoiceId, applied, creditId, -applied]);
    await refreshInvoiceStatus(invoiceId, c);
    await refreshInvoiceStatus(creditId, c);
    await audit({ actor: user.username, action: "credit.applied", entityType: "invoice", entityId: invoiceId, summary: `${memo}: $${applied.toFixed(2)}` }, c);
    return r!.id;
  };
  return on ? run(on) : tx(run);
}

/** NSF / returned payment (CSH-16): reverse the receipt and its applications. A refund is stored as a negative receipt, so reversing one voids the refund (CR-045). */
export async function reverseReceipt(receiptId: number, reason: string, user: Pick<User, "username">, on?: Queryable): Promise<{ refund: boolean }> {
  const run = async (c: Queryable) => {
    const r = await one<{ id: number; amount: string; client_id: number; receipt_number: string; status: string; method: string }>("SELECT * FROM receipts WHERE id = $1 FOR UPDATE", [receiptId], c);
    if (!r || r.status !== "finalized") throw new Error("Only a finalized receipt can be reversed.");
    const amount = Number(r.amount), refund = amount < 0;
    const why = reason.trim() || (refund ? "Refund check voided" : r.method === "credit" ? "Applied in error" : "NSF — returned by bank");
    const over = await one<{ id: number; total: string }>("SELECT id, total FROM invoices WHERE source_receipt_id = $1 AND status <> 'void' FOR UPDATE", [receiptId], c);
    if (over && Math.abs((await invoiceBalance(over.id, c)) - Number(over.total)) > 0.004) throw new Error("The overpayment on this receipt has been refunded or applied. Undo that first.");
    if (over) await c.query("UPDATE invoices SET status = 'void' WHERE id = $1", [over.id]);
    await c.query("UPDATE receipts SET status = 'reversed', reversed_reason = $2 WHERE id = $1", [receiptId, why]);
    for (const a of await q<{ invoice_id: number }>("SELECT invoice_id FROM receipt_applications WHERE receipt_id = $1", [receiptId], c)) await refreshInvoiceStatus(a.invoice_id, c);
    await post({ date: todayISO(), memo: `${refund ? "Void of refund" : "Reversal of"} ${r.receipt_number}: ${why}`, refType: "receipt", refId: receiptId, clientId: r.client_id },
      refund ? [{ account: "trust_cash", debit: -amount }, { account: "premium_receivable", credit: -amount }]
        : [{ account: "premium_receivable", debit: amount }, { account: "trust_cash", credit: amount }], c);
    await audit({ actor: user.username, action: "receipt.reversed", entityType: "receipt", entityId: receiptId, summary: `${refund ? "Voided refund" : "Reversed"} ${r.receipt_number}: ${why}` }, c);
    return { refund };
  };
  return on ? run(on) : tx(run);
}

// ───────────────────────── Carrier payables (GL-04, GL-05)

/** Agency-bill amounts owed to a carrier: paid invoice lines not yet on a paid statement. */
export async function carrierPayables(carrierId?: number) {
  return q<{ carrier_id: number; carrier: string; lines: number; owed: string; oldest: string }>(
    `SELECT il.carrier_id, ca.name AS carrier, count(*)::int AS lines, sum(il.payable_amount)::text AS owed, min(i.issue_date) AS oldest
       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN carriers ca ON ca.id = il.carrier_id
      WHERE il.payable_to = 'carrier' AND il.carrier_statement_id IS NULL AND (i.status = 'paid' OR i.total < 0) AND i.status <> 'void'
        ${carrierId ? "AND il.carrier_id = $1" : ""}
      GROUP BY il.carrier_id, ca.name ORDER BY ca.name`, carrierId ? [carrierId] : []);
}

/** Pay a carrier by statement: every collected, unpaid line goes on one statement and one trust disbursement. */
export async function payCarrierStatement(carrierId: number, reference: string, user: Pick<User, "username">, on?: Queryable, returned = false): Promise<number> {
  const run = async (c: Queryable) => {
    const lines = await q<{ id: number; payable_amount: string }>(
      `SELECT il.id, il.payable_amount FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
        WHERE il.carrier_id = $1 AND il.payable_to = 'carrier' AND il.carrier_statement_id IS NULL AND (i.status = 'paid' OR i.total < 0) AND i.status <> 'void' FOR UPDATE OF il`, [carrierId], c);
    if (!lines.length) throw new Error("Nothing collected is waiting to be paid to this carrier.");
    const total = round(lines.reduce((s, l) => s + Number(l.payable_amount), 0));
    // Only return premium here means the carrier owes the agency. Trust cash moves when that money really arrives (CR-051).
    if (total < 0 && !returned) throw new Error(`This carrier owes the agency $${(-total).toFixed(2)}. Record the return when the money arrives.`);
    if (total >= 0 && returned) throw new Error("This carrier doesn't owe the agency anything right now.");
    if (returned && !reference.trim()) throw new Error("Enter the deposit reference for the return.");
    const date = todayISO();
    const st = await one<{ id: number }>(
      "INSERT INTO carrier_statements (carrier_id, statement_date, status, total, paid_date, reference) VALUES ($1,$2,'paid',$3,$2,$4) RETURNING id",
      [carrierId, date, total, reference], c);
    await c.query("UPDATE invoice_lines SET carrier_statement_id = $1 WHERE id = ANY($2)", [st!.id, lines.map((l) => l.id)]);
    await post({ date, memo: `${returned ? "Return from carrier" : "Carrier statement payment"} ${reference}`, refType: "carrier_statement", refId: st!.id, carrierId },
      [{ account: "carrier_payable", debit: total }, { account: "trust_cash", credit: total }], c);
    await audit({ actor: user.username, action: "carrier_statement.paid", entityType: "carrier_statement", entityId: st!.id, summary: `${returned ? `Return of $${(-total).toFixed(2)} received` : `Paid $${total.toFixed(2)}`} (${lines.length} items) ref ${reference}` }, c);
    return st!.id;
  };
  return on ? run(on) : tx(run);
}

// ───────────────────────── Trust (GL-23..25)

export async function balances(asOf = todayISO(), on: Queryable = db): Promise<Record<Account, number>> {
  const rows = await q<{ account: Account; bal: string }>(
    "SELECT account, sum(debit - credit)::text AS bal FROM ledger_entries WHERE entry_date <= $1 GROUP BY account", [asOf], on);
  const out = Object.fromEntries(Object.keys(ACCOUNT_LABEL).map((k) => [k, 0])) as Record<Account, number>;
  for (const r of rows) out[r.account] = Number(r.bal);
  return out;
}

/** What may be swept from trust to operating: trust cash beyond what is owed to carriers and states. */
export async function sweepable(on: Queryable = db): Promise<{ trust: number; owed: number; available: number; uncollected: number; credits: number; carriers: number; taxes: number }> {
  const b = await balances(todayISO(), on);
  // Payables are booked when an invoice is issued, but trust only has to hold what was collected:
  // take out the carrier and tax share of balances clients still owe, payee by payee.
  const u = await q<{ payable_to: string; carrier_id: number | null; v: string }>(`
    SELECT il.payable_to, il.carrier_id, sum(CASE WHEN il.payable_to = 'carrier' THEN il.payable_amount ELSE il.amount END * x.bal / nullif(x.total, 0))::text AS v
      FROM (SELECT i.id, i.total,
                   i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'), 0) AS bal
              FROM invoices i WHERE i.status IN ('open','partial') AND i.total > 0) x
      JOIN invoice_lines il ON il.invoice_id = x.id
     WHERE x.bal > 0 AND il.payable_to IN ('carrier','state')
       -- A line already paid to the carrier is off the payable, so a reopened invoice can't offset what's still owed (CR-044).
       AND (il.payable_to <> 'carrier' OR il.carrier_statement_id IS NULL)
     GROUP BY il.payable_to, il.carrier_id`, [], on);
  const uncollected = round(u.reduce((s, r) => s + Number(r.v), 0));
  const uncollectedTax = u.filter((r) => r.payable_to === "state").reduce((s, r) => s + Number(r.v), 0);
  // Each carrier separately: a return one carrier still owes the agency isn't cash, so it can't offset what is owed to the others (CR-026).
  const payables = await q<{ carrier_id: number | null; owed: string }>(
    "SELECT carrier_id, sum(credit - debit)::text AS owed FROM ledger_entries WHERE account = 'carrier_payable' AND entry_date <= $1 GROUP BY carrier_id", [todayISO()], on);
  const uncollectedBy = new Map(u.filter((r) => r.payable_to === "carrier").map((r) => [r.carrier_id, Number(r.v)]));
  const carriers = round(payables.reduce((s, p) => s + Math.max(0, Number(p.owed) - (uncollectedBy.get(p.carrier_id) ?? 0)), 0));
  const taxes = round(Math.max(0, -b.tax_payable - uncollectedTax));
  // Return premium credited to clients and not yet refunded is their money, whether or not the carrier has sent its share back (CR-001).
  const cr = await one<{ v: string }>(`
    SELECT coalesce(sum(-(i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'), 0))), 0)::text AS v
      FROM invoices i WHERE i.status = 'open' AND i.total < 0`, [], on);
  const credits = round(Number(cr?.v ?? 0));
  const owed = round(carriers + taxes + Math.max(0, -b.refunds_payable) + credits);
  const trust = round(b.trust_cash);
  return { trust, owed, available: Math.max(0, Math.min(trust, round(trust - owed))), uncollected, credits, carriers, taxes };
}

export async function sweepTrust(amount: number, user: Pick<User, "username">) {
  await tx(async (c) => {
    // One sweep at a time, with the limit worked out under the lock: two at once can't both spend it (CR-013).
    await c.query("SELECT pg_advisory_xact_lock(hashtext('premium-trust'))");
    const s = await sweepable(c);
    if (amount <= 0 || amount > s.available + 0.004) throw new Error(`Only ${s.available.toFixed(2)} can be swept: the rest is owed to carriers, states and clients.`);
    await post({ date: todayISO(), memo: "Earned commission sweep, trust to operating", refType: "sweep", refId: 0 },
      [{ account: "operating_cash", debit: amount }, { account: "trust_cash", credit: amount }], c);
    await audit({ actor: user.username, action: "trust.swept", entityType: "ledger", entityId: "trust", summary: `Swept $${amount.toFixed(2)} trust → operating` }, c);
  });
}

// ───────────────────────── Direct bill commission (COM-11..21)

/**
 * The policy term a commission line belongs to: same number, this carrier (or wholesaler), and the
 * term the line's date falls in. Policy numbers often carry over between renewals, so without a date
 * the newest term is the best guess (CR-012).
 */
export async function findTermForLine(policyNumber: string, carrierId: number, effectiveDate: string | null, on: Queryable = db) {
  return one<{ id: number; commission_pct: string }>(
    `SELECT id, commission_pct FROM policies
      WHERE (upper(policy_number) = upper($1) OR upper(replace(policy_number,'-','')) = upper(replace($1,'-','')))
        AND (carrier_id = $2 OR wholesaler_id = $2)
      ORDER BY CASE WHEN $3::date >= effective_date AND $3::date < expiration_date THEN 0 ELSE 1 END, effective_date DESC LIMIT 1`,
    [policyNumber.trim(), carrierId, effectiveDate], on);
}

/** Link a line to a term and compare what the carrier paid with what the agreement says. */
export async function applyLineMatch(line: { id: number; premium: string; commission: string }, p: { id: number; commission_pct: string }, on: Queryable = db) {
  const tol = await getSetting("commission_variance", DEFAULTS.commission_variance, on);
  const expected = round((Number(line.premium) * Number(p.commission_pct)) / 100);
  const status = Math.abs(expected - Number(line.commission)) <= Math.max(tol.dollars, (Math.abs(expected) * tol.pct) / 100) ? "matched" : "variance";
  await on.query("UPDATE commission_lines SET policy_id = $2, expected_commission = $3, match_status = $4 WHERE id = $1", [line.id, p.id, expected, status]);
}

/** Match a statement's lines to policies and compare to the expected commission. */
export async function matchCommissionLines(statementId: number, on: Queryable = db) {
  const st = await one<{ carrier_id: number }>("SELECT carrier_id FROM commission_statements WHERE id = $1", [statementId], on);
  // Lines someone closed, or whose variance they accepted, have been decided: a re-run leaves them alone.
  const lines = await q<{ id: number; policy_number: string; effective_date: string | null; premium: string; commission: string }>(
    "SELECT id, policy_number, effective_date, premium, commission FROM commission_lines WHERE statement_id = $1 AND match_status <> 'closed' AND NOT variance_accepted", [statementId], on);
  for (const l of lines) {
    const p = await findTermForLine(l.policy_number, st!.carrier_id, l.effective_date, on);
    if (!p) { await on.query("UPDATE commission_lines SET policy_id = NULL, expected_commission = NULL, match_status = 'unmatched' WHERE id = $1", [l.id]); continue; }
    await applyLineMatch(l, p, on);
  }
}

/** The carrier's deposit as it arrived, correctable only while the statement is a draft (CR-007). */
export async function setStatementDeposit(statementId: number, amount: number, date: string, user: Pick<User, "username">) {
  await tx(async (c) => {
    const st = await one<{ status: string; deposit_amount: string | null }>("SELECT status, deposit_amount FROM commission_statements WHERE id = $1 FOR UPDATE", [statementId], c);
    if (!st || st.status !== "draft") throw new Error("Only a draft statement's deposit can be changed.");
    await c.query("UPDATE commission_statements SET deposit_amount = $2, deposit_date = $3 WHERE id = $1", [statementId, amount, date]);
    await audit({ actor: user.username, action: "commission_statement.deposit", entityType: "commission_statement", entityId: statementId, summary: `Deposit corrected to $${amount.toFixed(2)} on ${date}`, before: { deposit_amount: st.deposit_amount }, after: { deposit_amount: amount } }, c);
  });
}

/** Post a reconciled statement: the deposit is commission income (COM-19). */
export async function postCommissionStatement(statementId: number, user: Pick<User, "username">, on?: Queryable) {
  const run = async (c: Queryable) => {
    const st = await one<{ id: number; status: string; carrier_id: number; deposit_amount: string | null; deposit_date: string | null; period: string }>(
      "SELECT * FROM commission_statements WHERE id = $1 FOR UPDATE", [statementId], c);
    if (!st || st.status !== "draft") throw new Error("Only a draft statement can be posted.");
    const open = await one<{ n: number }>("SELECT count(*)::int AS n FROM commission_lines WHERE statement_id = $1 AND match_status = 'unmatched'", [statementId], c);
    if (open!.n) throw new Error(`${open!.n} line(s) are still unmatched: match them to a policy or close them first.`);
    const total = Number((await one<{ t: string }>("SELECT coalesce(sum(commission),0)::text AS t FROM commission_lines WHERE statement_id = $1 AND match_status <> 'closed'", [statementId], c))!.t);
    // The carrier's actual deposit, never the lines' own total, or this check could never fail (CR-032).
    if (st.deposit_amount == null) throw new Error("Record the carrier's deposit before posting.");
    const deposit = Number(st.deposit_amount);
    if (Math.abs(deposit - total) > 0.01) throw new Error(`The deposit ($${deposit.toFixed(2)}) doesn't equal the statement lines ($${total.toFixed(2)}).`);
    const date = st.deposit_date ?? todayISO();
    await post({ date, memo: `Direct bill commission ${st.period}`, refType: "commission_statement", refId: statementId, carrierId: st.carrier_id },
      [{ account: "operating_cash", debit: total }, { account: "commission_income", credit: total }], c);
    await c.query("UPDATE commission_statements SET status = 'posted', posted_at = now(), statement_total = $2 WHERE id = $1", [statementId, total]);
    await audit({ actor: user.username, action: "commission_statement.posted", entityType: "commission_statement", entityId: statementId, summary: `Posted $${total.toFixed(2)} for ${st.period}` }, c);
  };
  await (on ? run(on) : tx(run));
}

// ───────────────────────── Producer compensation (COM-23, COM-24)

/**
 * Build (or rebuild) a producer's statement for a period: all commission the agency has collected by
 * the end of it that no statement has picked up yet (CR-006). Agency bill counts from the date the
 * client paid, direct bill from the carrier's deposit, so money that arrives after a month closed is
 * paid in the next one. Each source line goes on one statement. Lines from before this tracking
 * existed name no invoice line, so they are recognised by policy and amount.
 */
export async function buildProducerStatement(userId: number, period: string, on?: Queryable): Promise<number | null> {
  return on ? buildStatement(userId, period, on) : tx((c) => buildStatement(userId, period, c));
}

async function buildStatement(userId: number, period: string, on: Queryable): Promise<number | null> {
  const u = await one<{ commission_new_pct: string; commission_renewal_pct: string }>("SELECT commission_new_pct, commission_renewal_pct FROM users WHERE id = $1", [userId], on);
  if (!u || (Number(u.commission_new_pct) === 0 && Number(u.commission_renewal_pct) === 0)) return null;
  const existing = await one<{ id: number; status: string }>("SELECT id, status FROM producer_statements WHERE user_id = $1 AND period = $2 FOR UPDATE", [userId, period], on);
  if (existing?.status === "paid") return existing.id;
  const id = existing?.id ?? (await one<{ id: number }>("INSERT INTO producer_statements (user_id, period) VALUES ($1,$2) RETURNING id", [userId, period], on))!.id;
  await on.query("DELETE FROM producer_statement_lines WHERE statement_id = $1", [id]);
  // An earlier statement that came out negative is never paid. Dropping it lets its chargebacks net off against this one (CR-051).
  await on.query("DELETE FROM producer_statement_lines WHERE statement_id IN (SELECT id FROM producer_statements WHERE user_id = $1 AND status = 'draft' AND total < 0 AND period < $2)", [userId, period]);
  await on.query("DELETE FROM producer_statements WHERE user_id = $1 AND status = 'draft' AND total < 0 AND period < $2", [userId, period]);
  const rows = await q<{ policy_id: number; line_id: number | null; invoice_line_id: number | null; commission: string; new_renewal: string }>(
    `WITH period_end AS (SELECT (to_date($2 || '-01', 'YYYY-MM-DD') + interval '1 month')::date AS d)
     SELECT cl.policy_id, cl.id AS line_id, NULL::int AS invoice_line_id, cl.commission, p.new_renewal
       FROM commission_lines cl JOIN commission_statements cs ON cs.id = cl.statement_id JOIN policies p ON p.id = cl.policy_id, period_end e
      WHERE cs.status = 'posted' AND coalesce(cs.deposit_date, cs.posted_at::date, cs.statement_date) < e.d AND p.producer_id = $1 AND cl.match_status IN ('matched','variance')
        AND NOT EXISTS (SELECT 1 FROM producer_statement_lines x WHERE x.commission_line_id = cl.id AND x.statement_id <> $3)
     UNION ALL
     SELECT i.policy_id, NULL, il.id, il.commission_amount, p.new_renewal
       FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id JOIN policies p ON p.id = i.policy_id, period_end e
      WHERE i.status = 'paid' AND p.producer_id = $1 AND il.commission_amount <> 0
        AND coalesce((SELECT max(r.received_date) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'), i.issue_date) < e.d
        AND NOT EXISTS (SELECT 1 FROM producer_statement_lines x WHERE x.statement_id <> $3
                           AND (x.invoice_line_id = il.id OR (x.invoice_line_id IS NULL AND x.commission_line_id IS NULL AND x.policy_id = i.policy_id AND x.agency_commission = il.commission_amount)))`, [userId, period, id], on);
  let total = 0;
  for (const r of rows) {
    const c = Number(r.commission);
    const isNew = r.new_renewal === "new";
    const pctv = Number(isNew ? u.commission_new_pct : u.commission_renewal_pct);
    const amount = round((c * pctv) / 100);
    total += amount;
    await on.query(`INSERT INTO producer_statement_lines (statement_id, policy_id, commission_line_id, invoice_line_id, kind, agency_commission, split_pct, amount)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, r.policy_id, r.line_id, r.invoice_line_id, c < 0 ? "chargeback" : isNew ? "new" : "renewal", c, pctv, amount]);
  }
  await on.query("UPDATE producer_statements SET total = $2 WHERE id = $1", [id, round(total)]);
  return id;
}

export async function payProducerStatement(id: number, user: Pick<User, "username">, on?: Queryable) {
  const run = async (c: Queryable) => {
    const s = await one<{ id: number; total: string; status: string; period: string; user_id: number }>("SELECT * FROM producer_statements WHERE id = $1 FOR UPDATE", [id], c);
    if (!s || s.status !== "draft") throw new Error("Only a draft statement can be paid.");
    const total = Number(s.total);
    if (total < 0) throw new Error(`This statement is $${(-total).toFixed(2)} of chargebacks, so there's nothing to pay. It nets off against the next statement you build.`);
    const date = todayISO();
    await post({ date, memo: `Producer commission ${s.period}`, refType: "producer_statement", refId: id },
      [{ account: "producer_expense", debit: total }, { account: "producer_payable", credit: total }], c);
    await post({ date, memo: `Producer commission paid ${s.period}`, refType: "producer_statement", refId: id },
      [{ account: "producer_payable", debit: total }, { account: "operating_cash", credit: total }], c);
    await c.query("UPDATE producer_statements SET status = 'paid', paid_at = now() WHERE id = $1", [id]);
    await audit({ actor: user.username, action: "producer_statement.paid", entityType: "producer_statement", entityId: id, summary: `Paid $${total.toFixed(2)} for ${s.period}` }, c);
  };
  await (on ? run(on) : tx(run));
}

// ───────────────────────── Receivables (BIL-31, BIL-32)

export async function aging(asOf = todayISO()) {
  return q<{ client_id: number; client: string; current: string; d30: string; d60: string; d90: string; total: string }>(
    `WITH bal AS (
       SELECT i.id, i.client_id, i.due_date,
              i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id
                                   WHERE ra.invoice_id = i.id AND r.status = 'finalized'),0) AS bal
         FROM invoices i WHERE i.status IN ('open','partial'))
     SELECT b.client_id, c.name AS client,
            sum(CASE WHEN $1::date - b.due_date <= 0 THEN bal ELSE 0 END)::text AS current,
            sum(CASE WHEN $1::date - b.due_date BETWEEN 1 AND 30 THEN bal ELSE 0 END)::text AS d30,
            sum(CASE WHEN $1::date - b.due_date BETWEEN 31 AND 60 THEN bal ELSE 0 END)::text AS d60,
            sum(CASE WHEN $1::date - b.due_date > 60 THEN bal ELSE 0 END)::text AS d90,
            sum(bal)::text AS total
       FROM bal b JOIN clients c ON c.id = b.client_id WHERE bal > 0.004
      GROUP BY b.client_id, c.name ORDER BY sum(bal) DESC`, [asOf]);
}
