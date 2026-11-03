"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applyCredit, applyLineMatch, buildProducerStatement, createInvoice, createReceipt, findTermForLine, refundInvoice, matchCommissionLines, payCarrierStatement, payProducerStatement, postCommissionStatement, reverseReceipt, setStatementDeposit, sweepTrust } from "@/lib/accounting";
import { extractStatementAI } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { db, one, tx, type Queryable } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { safeLocalPath } from "@/lib/http";
import { requirePerm } from "@/lib/user";

const go = (path: string, key: "msg" | "error", text: string): never => { revalidatePath("/accounting", "layout"); redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`); };
const money = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(/[$,\s]/g, "")) || 0;
async function guard<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (err) { if ((err as Error).message?.startsWith("NEXT_REDIRECT")) throw err; return go(path, "error", (err as Error).message); }
}

export async function receiptAction(f: FormData) {
  const u = await requirePerm("accounting");
  const clientId = Number(f.get("client_id"));
  const amount = money(f.get("amount"));
  if (!clientId || amount <= 0) go("/accounting/receipts/new", "error", "Pick a client and enter the amount.");
  const apply = f.getAll("invoice_ids").map(Number).filter(Boolean);
  const receiptId = await guard(`/accounting/receipts/new?client=${clientId}`, () => createReceipt({ clientId, amount, method: String(f.get("method") || "check"), reference: String(f.get("reference") || "") || undefined, date: String(f.get("date") || "") || undefined, memo: String(f.get("memo") || "") || undefined, applyTo: apply.length ? apply : undefined }, u));
  const over = await one<{ total: string }>("SELECT total FROM invoices WHERE source_receipt_id = $1", [receiptId]);
  go(`/clients/${clientId}?tab=billing`, "msg", `Receipt of $${amount.toFixed(2)} posted to trust and applied${over ? `; $${(-Number(over.total)).toFixed(2)} over what was owed is now a credit on the account` : ""}`);
}

export async function reverseReceiptAction(f: FormData) {
  const u = await requirePerm("accounting");
  const { refund } = await guard("/accounting/receipts", () => reverseReceipt(Number(f.get("id")), String(f.get("reason") ?? ""), u));
  go("/accounting/receipts", "msg", refund ? "Refund voided; the credit is open again" : "Receipt reversed; the invoices are open again");
}

export async function invoiceAction(f: FormData) {
  const u = await requirePerm("accounting");
  const clientId = Number(f.get("client_id"));
  const amount = money(f.get("amount"));
  const kind = String(f.get("kind") || "agency_fee");
  if (!clientId || !amount) go("/accounting/invoices", "error", "Pick a client and an amount.");
  if (kind !== "agency_fee" && kind !== "broker_fee" && kind !== "policy_fee") go("/accounting/invoices", "error", "Pick a fee type.");
  await guard("/accounting/invoices", () => createInvoice({ clientId, policyId: Number(f.get("policy_id")) || null, memo: String(f.get("description") || "Agency fee"),
    lines: [{ kind: kind as "agency_fee" | "broker_fee" | "policy_fee", description: String(f.get("description") || "Agency fee"), amount }] }, u.username));
  go("/accounting/invoices", "msg", "Invoice created");
}

export async function recordCarrierReturnAction(f: FormData) {
  const u = await requirePerm("accounting");
  const ref = String(f.get("reference") ?? "").trim();
  await guard("/accounting/payables", () => payCarrierStatement(Number(f.get("carrier_id")), ref, u, undefined, true));
  go("/accounting/payables", "msg", "Return from the carrier recorded in trust");
}

export async function payCarrierAction(f: FormData) {
  const u = await requirePerm("accounting");
  const ref = String(f.get("reference") ?? "").trim() || `ACH ${todayISO()}`;
  await guard("/accounting/payables", () => payCarrierStatement(Number(f.get("carrier_id")), ref, u));
  go("/accounting/payables", "msg", "Carrier statement paid from trust");
}

export async function sweepAction(f: FormData) {
  const u = await requirePerm("accounting");
  await guard("/accounting/trust", () => sweepTrust(money(f.get("amount")), u));
  go("/accounting/trust", "msg", "Commission swept to operating");
}

/** New direct-bill commission statement: from a carrier CSV, from a PDF read by Claude, or empty for manual entry. */
export async function newStatementAction(f: FormData) {
  const u = await requirePerm("accounting");
  const carrierId = Number(f.get("carrier_id"));
  const file = f.get("file");
  let lines: { policy_number: string; insured_name: string | null; effective_date: string | null; transaction_kind: string; premium: number; rate_pct: number | null; commission: number }[] = [];
  let source: "manual" | "import" | "ai" = "manual";
  let statementDate = String(f.get("statement_date") || todayISO());
  if (file && typeof file !== "string" && file.size > 0) {
    const buf = Buffer.from(await file.arrayBuffer());
    if (/\.csv$/i.test(file.name) || file.type === "text/csv") {
      lines = parseCsvStatement(buf.toString("utf8"));
      source = "import";
      if (!lines.length) go("/accounting/commissions", "error", "No lines found. The CSV needs columns for policy number, premium and commission.");
    } else {
      const r = await extractStatementAI(buf, file.type || "application/pdf");
      if (!r) go("/accounting/commissions", "error", "Reading a PDF statement needs ANTHROPIC_API_KEY and the assist turned on in Admin > Settings. Upload the carrier's CSV instead, or enter lines manually.");
      lines = r!.lines.map((l) => ({ ...l, insured_name: l.insured_name || null }));
      statementDate = r!.statement_date ?? statementDate;
      source = "ai";
    }
  }
  const id = await tx(async (c) => {
    const total = Math.round(lines.reduce((s, l) => s + l.commission, 0) * 100) / 100;
    const st = await one<{ id: number }>("INSERT INTO commission_statements (carrier_id, statement_date, period, source, statement_total, deposit_amount, deposit_date, created_by_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [carrierId, statementDate, String(f.get("period") || statementDate.slice(0, 7)), source, total, money(f.get("deposit_amount")) || null, String(f.get("deposit_date") || statementDate), u.id], c);
    for (const l of lines) {
      await c.query("INSERT INTO commission_lines (statement_id, policy_number, insured_name, effective_date, transaction_kind, premium, rate_pct, commission) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [st!.id, l.policy_number, l.insured_name, l.effective_date, l.transaction_kind, l.premium, l.rate_pct, l.commission]);
    }
    await matchCommissionLines(st!.id, c);
    await audit({ actor: u.username, action: "commission_statement.created", entityType: "commission_statement", entityId: st!.id, summary: `${lines.length} line(s) via ${source}` }, c);
    return st!.id;
  });
  go(`/accounting/commissions/${id}`, "msg", lines.length ? `${lines.length} lines loaded and matched to policies` : "Statement created — add lines below");
}

/** Carrier CSV: finds the policy, insured, premium, rate and commission columns by header name. */
function parseCsvStatement(text: string) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => { const out: string[] = []; let cur = "", qd = false; for (const ch of l) { if (ch === '"') qd = !qd; else if (ch === "," && !qd) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()); });
  if (rows.length < 2) return [];
  const h = rows[0].map((x) => x.toLowerCase());
  const col = (...names: string[]) => h.findIndex((x) => names.some((n) => x.includes(n)));
  const ip = col("policy"), ii = col("insured", "name"), ie = col("effective", "eff"), it = col("trans", "type"), ipr = col("premium"), ir = col("rate", "%"), ic = col("commission", "comm");
  if (ip < 0 || ic < 0) return [];
  const num = (v?: string) => Number(String(v ?? "").replace(/[$,()\s]/g, "")) * (/\(.*\)/.test(v ?? "") ? -1 : 1) || 0;
  return rows.slice(1).filter((r) => r[ip]).map((r) => ({ policy_number: r[ip], insured_name: ii >= 0 ? r[ii] : null, effective_date: ie >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(r[ie]) ? r[ie] : null,
    transaction_kind: it >= 0 ? (r[it].toLowerCase().startsWith("ren") ? "renewal" : r[it].toLowerCase().startsWith("end") ? "endorsement" : r[it].toLowerCase().startsWith("can") ? "cancellation" : "new") : "new",
    premium: ipr >= 0 ? num(r[ipr]) : 0, rate_pct: ir >= 0 ? num(r[ir]) || null : null, commission: num(r[ic]) }));
}

/** A posted statement fed the ledger and producer statements, so its lines stay as they were (CR-032). */
async function lockDraft(id: number, c: Queryable) {
  const st = await one<{ status: string }>("SELECT status FROM commission_statements WHERE id = $1 FOR UPDATE", [id], c);
  if (st?.status !== "draft") throw new Error("Only a draft statement's lines can be changed.");
}

export async function addLineAction(f: FormData) {
  await requirePerm("accounting");
  const id = Number(f.get("id"));
  await guard(`/accounting/commissions/${id}`, () => tx(async (c) => {
    await lockDraft(id, c);
    await c.query("INSERT INTO commission_lines (statement_id, policy_number, insured_name, transaction_kind, premium, rate_pct, commission) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, String(f.get("policy_number")).trim(), String(f.get("insured_name") || "") || null, String(f.get("transaction_kind") || "new"), money(f.get("premium")), money(f.get("rate_pct")) || null, money(f.get("commission"))]);
    await matchCommissionLines(id, c);
    await c.query("UPDATE commission_statements SET statement_total = (SELECT coalesce(sum(commission),0) FROM commission_lines WHERE statement_id = $1) WHERE id = $1", [id]);
  }));
  go(`/accounting/commissions/${id}`, "msg", "Line added");
}

export async function lineAction(f: FormData) {
  const u = await requirePerm("accounting");
  const id = Number(f.get("id")), lineId = Number(f.get("line_id")), op = String(f.get("op"));
  await guard(`/accounting/commissions/${id}`, () => tx(async (c) => {
    await lockDraft(id, c);
    if (op === "close") await c.query("UPDATE commission_lines SET match_status = 'closed', note = $3 WHERE id = $1 AND statement_id = $2", [lineId, id, String(f.get("note") || "Closed without matching")]);
    if (op === "accept") await c.query("UPDATE commission_lines SET match_status = 'matched', variance_accepted = true, note = coalesce(note, '') || ' Variance accepted' WHERE id = $1 AND statement_id = $2", [lineId, id]);
    if (op === "match") {
      const number = String(f.get("policy_number")).trim();
      const l = await one<{ id: number; premium: string; commission: string; effective_date: string | null; carrier_id: number }>(
        "SELECT cl.id, cl.premium, cl.commission, cl.effective_date, cs.carrier_id FROM commission_lines cl JOIN commission_statements cs ON cs.id = cl.statement_id WHERE cl.id = $1 AND cl.statement_id = $2", [lineId, id], c);
      const p = l && await findTermForLine(number, l.carrier_id, l.effective_date, c);
      if (!l || !p) throw new Error("This carrier has no policy with that number.");
      await c.query("UPDATE commission_lines SET policy_number = $2, variance_accepted = false WHERE id = $1", [lineId, number]);
      await applyLineMatch(l, p, c);
    }
    if (op === "rematch") await matchCommissionLines(id, c);
    await audit({ actor: u.username, action: `commission_line.${op}`, entityType: "commission_statement", entityId: id, summary: `Line ${lineId}: ${op}` }, c);
  }));
  go(`/accounting/commissions/${id}`, "msg", "Updated");
}

export async function postStatementAction(f: FormData) {
  const u = await requirePerm("accounting");
  const id = Number(f.get("id"));
  await guard(`/accounting/commissions/${id}`, () => postCommissionStatement(id, u));
  go(`/accounting/commissions/${id}`, "msg", "Statement posted: commission income recorded");
}

export async function depositAction(f: FormData) {
  const u = await requirePerm("accounting");
  const id = Number(f.get("id"));
  await guard(`/accounting/commissions/${id}`, () => setStatementDeposit(id, money(f.get("deposit_amount")), String(f.get("deposit_date") || todayISO()), u));
  go(`/accounting/commissions/${id}`, "msg", "Deposit updated");
}

/** Stamp a month's journals as sent to the general ledger. Separate from downloading, which changes nothing (CR-016). */
export async function markExportedAction(f: FormData) {
  const u = await requirePerm("accounting");
  const month = String(f.get("month"));
  const r = await db.query("UPDATE ledger_entries SET exported_batch = coalesce(exported_batch, $2) WHERE to_char(entry_date, 'YYYY-MM') = $1 AND exported_batch IS NULL", [month, `gl-${todayISO()}`]);
  await audit({ actor: u.username, action: "ledger.exported", entityType: "ledger", entityId: month, summary: `Marked ${month} as exported (${r.rowCount} entries)` });
  go(`/accounting/ledger?month=${month}`, "msg", `${month} marked as exported`);
}

export async function buildProducerAction(f: FormData) {
  const u = await requirePerm("accounting");
  const period = String(f.get("period"));
  const producers = await db.query<{ id: number }>("SELECT id FROM users WHERE active AND (commission_new_pct > 0 OR commission_renewal_pct > 0)");
  let n = 0;
  for (const p of producers.rows) if (await buildProducerStatement(p.id, period)) n++;
  await audit({ actor: u.username, action: "producer_statements.built", entityType: "producer_statement", entityId: period, summary: `${n} statement(s) for ${period}` });
  go("/accounting/producers", "msg", `${n} producer statement(s) built for ${period}`);
}

export async function payProducerAction(f: FormData) {
  const u = await requirePerm("accounting");
  await guard("/accounting/producers", () => payProducerStatement(Number(f.get("id")), u));
  go("/accounting/producers", "msg", "Producer statement paid");
}

export async function lockPeriodAction(f: FormData) {
  const u = await requirePerm("accounting");
  const period = String(f.get("period")), lock = f.get("lock") === "1";
  await db.query("INSERT INTO accounting_periods (period, locked, locked_at, locked_by) VALUES ($1,$2,now(),$3) ON CONFLICT (period) DO UPDATE SET locked = $2, locked_at = now(), locked_by = $3", [period, lock, u.username]);
  await audit({ actor: u.username, action: lock ? "period.locked" : "period.unlocked", entityType: "period", entityId: period, summary: `${lock ? "Locked" : "Unlocked"} ${period}` });
  go("/accounting/ledger", "msg", `${period} ${lock ? "locked" : "unlocked"}`);
}

export async function applyCreditAction(f: FormData) {
  const u = await requirePerm("accounting");
  const back = safeLocalPath(String(f.get("back") || "/accounting/invoices"));
  const posted = String(f.get("amount") ?? "").trim();
  await guard(back, () => applyCredit(Number(f.get("credit_id")), Number(f.get("invoice_id")), posted ? money(posted) : null, u));
  go(back, "msg", "Credit applied");
}

export async function refundAction(f: FormData) {
  const u = await requirePerm("accounting");
  const back = safeLocalPath(String(f.get("back") || "/accounting/invoices?status=refunds"));
  await guard(back, () => refundInvoice(Number(f.get("invoice_id")), String(f.get("method") || "check"), String(f.get("reference") || "") || null, u));
  go(back, "msg", "Refund paid from trust");
}
