import { createInvoice, invoiceLinesFor, voidCredit } from "./accounting";
import { audit } from "./audit";
import { flagCertificates } from "./certificates";
import { db, one, q, tx, type Queryable } from "./db";
import { addDays, todayISO } from "./format";
import { LOBS } from "./ref";
import type { User } from "./user";
import { createActivity } from "./work";

// Policy lifecycle (POL-01..63, REN-09..18). Each action writes the policy change, a lineage row in
// policy_transactions, the agency-bill invoice when one is due, the follow-up work, and the audit row,
// in one transaction.

export type CoverageInput = { lob: string; code: string; description: string; limit_text?: string | null; deductible_text?: string | null; premium?: number | null };

export type PolicyInput = {
  clientId: number; policyNumber: string; carrierId: number; wholesalerId?: number | null; lob: string; lines: string[];
  effectiveDate: string; termMonths: number; premium: number; commissionPct: number; billMode: "direct" | "agency";
  isAdmitted: boolean; paymentPlan: string; financeCompanyId?: number | null; description?: string | null;
  producerId?: number | null; accountManagerId?: number | null; status: "bound" | "active"; binderNumber?: string | null; binderExpires?: string | null;
  newRenewal?: "new" | "renewal" | "rewrite"; priorPolicyId?: number | null; opportunityId?: number | null; coverages?: CoverageInput[];
};

export function expirationFor(effective: string, months: number): string {
  const d = new Date(`${effective}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export async function createPolicy(input: PolicyInput, user: Pick<User, "id" | "username">, on?: Queryable): Promise<number> {
  const run = async (c: Queryable) => {
    const client = await one<{ name: string; account_manager_id: number | null; producer_id: number | null; status: string }>(
      "SELECT name, account_manager_id, producer_id, status FROM clients WHERE id = $1", [input.clientId], c);
    if (!client) throw new Error("Client not found");
    // Producer pay is built on this number (SEC-031).
    if (!(input.commissionPct >= 0 && input.commissionPct <= 100)) throw new Error("The commission rate must be between 0 and 100%.");
    const exp = expirationFor(input.effectiveDate, input.termMonths);
    const am = input.accountManagerId ?? client.account_manager_id;
    const p = await one<{ id: number }>(
      `INSERT INTO policies (client_id, policy_number, carrier_id, wholesaler_id, lob, business_type, description, status, effective_date, expiration_date,
         term_months, bill_mode, premium, commission_pct, is_admitted, payment_plan, finance_company_id, new_renewal, prior_policy_id, producer_id,
         account_manager_id, binder_number, binder_expires, opportunity_id, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
      [input.clientId, input.policyNumber.trim(), input.carrierId, input.wholesalerId ?? null, input.lob, LOBS[input.lob]?.type ?? "commercial",
        input.description ?? null, input.status, input.effectiveDate, exp, input.termMonths, input.billMode, input.premium, input.commissionPct,
        input.isAdmitted, input.paymentPlan, input.financeCompanyId ?? null, input.newRenewal ?? "new", input.priorPolicyId ?? null,
        input.producerId ?? client.producer_id, am, input.binderNumber ?? null, input.binderExpires ?? null, input.opportunityId ?? null, input.status === "active" ? new Date() : null], c);
    const id = p!.id;
    const lines = input.lines.length ? input.lines : [input.lob];
    const each = Math.round((input.premium / lines.length) * 100) / 100;
    for (const lob of lines) await c.query("INSERT INTO policy_lines (policy_id, lob, premium) VALUES ($1,$2,$3)", [id, lob, each]);
    for (const cv of input.coverages ?? []) {
      await c.query("INSERT INTO coverages (policy_id, lob, code, description, limit_text, deductible_text, premium) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, cv.lob, cv.code, cv.description, cv.limit_text ?? null, cv.deductible_text ?? null, cv.premium ?? null]);
    }
    const t = await one<{ id: number }>(
      `INSERT INTO policy_transactions (policy_id, kind, status, effective_date, description, premium_change, created_by_id, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [id, input.newRenewal === "renewal" ? "renewal" : input.newRenewal === "rewrite" ? "rewrite" : "new", input.status === "active" ? "issued" : "pending",
        input.effectiveDate, `${input.newRenewal === "renewal" ? "Renewal" : "New business"} ${input.policyNumber}`, input.premium, user.id,
        input.status === "active" ? new Date() : null], c);
    if (client.status !== "insured") await c.query("UPDATE clients SET status = 'insured', client_since = coalesce(client_since, $2), updated_at = now() WHERE id = $1", [input.clientId, input.effectiveDate]);
    if (input.billMode === "agency" && input.premium > 0) {
      await createInvoice({ clientId: input.clientId, policyId: id, transactionId: t!.id, lines: await invoiceLinesFor(id, input.premium, c),
        memo: `${input.newRenewal === "renewal" ? "Renewal" : "New business"} ${input.policyNumber}` }, user.username, c);
    }
    if (input.newRenewal !== "renewal") {
      await createActivity({ code: "NB-SETUP", subject: `Set up new policy ${input.policyNumber} for ${client.name}`, ownerId: am, createdById: user.id,
        clientId: input.clientId, policyId: id, source: "system", actor: user.username }, c);
    }
    await createActivity({ code: "POL-CHECK", subject: `Policy check ${input.policyNumber} (${client.name})`, ownerId: am, createdById: user.id,
      clientId: input.clientId, policyId: id, dueDate: addDays(todayISO(), 14), source: "system", actor: user.username }, c);
    await audit({ actor: user.username, action: input.newRenewal === "renewal" ? "policy.renewed" : "policy.created", entityType: "policy", entityId: id,
      summary: `${input.policyNumber} ${input.lob} $${input.premium.toFixed(0)} eff ${input.effectiveDate}`, after: { ...input, coverages: undefined } }, c);
    return id;
  };
  return on ? run(on) : tx(run);
}

/** Carrier policy received (POL-19): bound → in force. */
/** The carrier's real number, replacing a PENDING- placeholder or a typo. Commission lines and email match on it (CR-049). */
export async function setPolicyNumber(policyId: number, number: string, user: Pick<User, "username">, on?: Queryable) {
  const run = async (c: Queryable) => {
    const next = number.trim();
    if (!next || /^PENDING-/i.test(next)) throw new Error("Enter the carrier's policy number.");
    const p = await one<{ policy_number: string }>("SELECT policy_number FROM policies WHERE id = $1 FOR UPDATE", [policyId], c);
    if (!p) throw new Error("Policy not found");
    if (p.policy_number === next) return;
    await c.query("UPDATE policies SET policy_number = $2, updated_at = now() WHERE id = $1", [policyId, next]);
    await audit({ actor: user.username, action: "policy.number_changed", entityType: "policy", entityId: policyId, summary: `Policy number ${p.policy_number} → ${next}`, before: { policy_number: p.policy_number }, after: { policy_number: next } }, c);
  };
  await (on ? run(on) : tx(run));
}

export async function markIssued(policyId: number, user: Pick<User, "username">, number?: string) {
  await tx(async (c) => {
    const p = await one<{ policy_number: string }>("SELECT policy_number FROM policies WHERE id = $1 FOR UPDATE", [policyId], c);
    if (number?.trim()) await setPolicyNumber(policyId, number, user, c);
    else if (p?.policy_number.startsWith("PENDING-")) throw new Error("Enter the carrier's policy number to mark it received.");
    await c.query("UPDATE policies SET status = CASE WHEN status = 'bound' THEN 'active' ELSE status END, issued_at = now(), updated_at = now() WHERE id = $1", [policyId]);
    await c.query("UPDATE policy_transactions SET status = 'issued', issued_at = now() WHERE policy_id = $1 AND kind IN ('new','renewal','rewrite') AND status = 'pending'", [policyId]);
    await audit({ actor: user.username, action: "policy.issued", entityType: "policy", entityId: policyId, summary: "Carrier policy received and issued" }, c);
  });
}

export async function recordPolicyCheck(policyId: number, user: Pick<User, "username">, result: string) {
  await db.query("UPDATE policies SET policy_checked_at = now() WHERE id = $1", [policyId]);
  await audit({ actor: user.username, action: "policy.checked", entityType: "policy", entityId: policyId, summary: result.slice(0, 200) });
}

/** Endorsement (POL-27..29). `issueNow` records it as issued; otherwise it waits for the carrier's endorsement. */
export async function endorsePolicy(policyId: number, e: { effectiveDate: string; description: string; premiumChange: number; issueNow: boolean }, user: Pick<User, "id" | "username">, on?: Queryable) {
  const run = async (c: Queryable) => {
    const p = await one<{ client_id: number; policy_number: string; bill_mode: string; premium: string; status: string; effective_date: string; expiration_date: string }>(
      "SELECT client_id, policy_number, bill_mode, premium, status, effective_date, expiration_date FROM policies WHERE id = $1 FOR UPDATE", [policyId], c);
    if (!p) throw new Error("Policy not found");
    if (!["active", "bound", "pending_cancel"].includes(p.status)) throw new Error("Only a policy in force can be endorsed.");
    if (e.effectiveDate < p.effective_date || e.effectiveDate > p.expiration_date) throw new Error(`The endorsement date must fall within the term (${p.effective_date} to ${p.expiration_date}).`);
    const t = await one<{ id: number }>(
      `INSERT INTO policy_transactions (policy_id, kind, status, effective_date, description, premium_change, created_by_id, issued_at)
       VALUES ($1,'endorsement',$2,$3,$4,$5,$6,$7) RETURNING id`,
      [policyId, e.issueNow ? "issued" : "pending", e.effectiveDate, e.description, e.premiumChange, user.id, e.issueNow ? new Date() : null], c);
    if (e.issueNow) await applyIssuedEndorsement(policyId, t!.id, e.premiumChange, p, user, c);
    await audit({ actor: user.username, action: "policy.endorsed", entityType: "policy", entityId: policyId,
      summary: `Endorsement eff ${e.effectiveDate}: ${e.description} (${e.premiumChange >= 0 ? "+" : ""}${e.premiumChange.toFixed(2)})${e.issueNow ? "" : " — pending carrier"}` }, c);
    return t!.id;
  };
  return on ? run(on) : tx(run);
}

async function applyIssuedEndorsement(policyId: number, txId: number, change: number, p: { client_id: number; policy_number: string; bill_mode: string }, user: Pick<User, "username">, c: Queryable) {
  const now = await one<{ premium: string }>("SELECT premium FROM policies WHERE id = $1", [policyId], c);
  if (Number(now?.premium) + change < 0) throw new Error(`This change would take the premium below zero (it's $${Number(now?.premium).toFixed(2)} now).`);
  await c.query("UPDATE policies SET premium = premium + $2, updated_at = now() WHERE id = $1", [policyId, change]);
  if (p.bill_mode === "agency" && change !== 0) {
    await createInvoice({ clientId: p.client_id, policyId, transactionId: txId, lines: await invoiceLinesFor(policyId, change, c), memo: `Endorsement ${p.policy_number}` }, user.username, c);
  }
}

export async function issueTransaction(txId: number, issued: boolean, user: Pick<User, "username">) {
  await tx(async (c) => {
    const t = await one<{ id: number; policy_id: number; status: string; premium_change: string; kind: string }>("SELECT * FROM policy_transactions WHERE id = $1 FOR UPDATE", [txId], c);
    if (!t || t.status !== "pending") throw new Error("Only a pending transaction can be issued.");
    if (t.kind === "cancellation") {
      // A non-pay notice ends one of two ways, each of which also has to change the policy: it goes through, or it is reinstated (CR-004).
      if (!issued) throw new Error("To undo a notice of cancellation, reinstate the policy.");
      await finalizeCancellation(t.policy_id, user, c);
      return;
    }
    await c.query("UPDATE policy_transactions SET status = $2, issued_at = now() WHERE id = $1", [txId, issued ? "issued" : "not_issued"]);
    if (issued && t.kind === "endorsement") {
      const p = await one<{ client_id: number; policy_number: string; bill_mode: string }>("SELECT client_id, policy_number, bill_mode FROM policies WHERE id = $1", [t.policy_id], c);
      await applyIssuedEndorsement(t.policy_id, txId, Number(t.premium_change), p!, user, c);
    }
    await audit({ actor: user.username, action: issued ? "transaction.issued" : "transaction.not_issued", entityType: "policy", entityId: t.policy_id, summary: `${t.kind} ${issued ? "issued" : "not issued"}` }, c);
  });
}

/** What a cancellation does once it is real, whoever or whatever made it so: the person, or the daily job when a notice's date passes. */
async function completeCancellation(p: { id: number; client_id: number; policy_number: string; bill_mode: string; account_manager_id: number | null; finance_company_id: number | null },
  txId: number, date: string, returnPremium: number, username: string, c: Queryable) {
  if (p.bill_mode === "agency" && returnPremium) {
    await createInvoice({ clientId: p.client_id, policyId: p.id, transactionId: txId, lines: await invoiceLinesFor(p.id, -Math.abs(returnPremium), c), memo: `Return premium ${p.policy_number}` }, username, c);
  }
  if (p.finance_company_id) {
    await createActivity({ code: "CANC-REQ", subject: `Notify finance company: ${p.policy_number} cancelled ${date}`, ownerId: p.account_manager_id, clientId: p.client_id, policyId: p.id, source: "system", actor: username }, c);
  }
  await flagCertificates(p.id, "cancelled", username, c);
}

type CancelRow = { id: number; status: string; client_id: number; policy_number: string; bill_mode: string; account_manager_id: number | null; finance_company_id: number | null; cancel_date: string | null; cancel_reason: string | null; return_premium: string | null };
const CANCEL_COLS = "id, status, client_id, policy_number, bill_mode, account_manager_id, finance_company_id, cancel_date, cancel_reason, return_premium";

/** A notice of cancellation goes through (CR-004): the pending transaction is issued and everything a cancellation does follows. */
export async function finalizeCancellation(policyId: number, user: Pick<User, "username">, on?: Queryable) {
  const run = async (c: Queryable) => {
    const p = await one<CancelRow>(`SELECT ${CANCEL_COLS} FROM policies WHERE id = $1 FOR UPDATE`, [policyId], c);
    if (!p || p.status !== "pending_cancel") throw new Error("Only a policy with a pending cancellation can be finalized.");
    const pending = await one<{ id: number }>("SELECT id FROM policy_transactions WHERE policy_id = $1 AND kind = 'cancellation' AND status = 'pending' ORDER BY id DESC LIMIT 1", [policyId], c);
    await c.query("UPDATE policies SET status = 'cancelled', updated_at = now() WHERE id = $1", [policyId]);
    const date = p.cancel_date ?? todayISO();
    const txId = pending?.id ?? (await one<{ id: number }>(
      "INSERT INTO policy_transactions (policy_id, kind, status, effective_date, description, premium_change) VALUES ($1,'cancellation','pending',$2,$3,$4) RETURNING id",
      [policyId, date, `Cancelled: ${p.cancel_reason ?? "notice of cancellation"}`, -Math.abs(Number(p.return_premium ?? 0))], c))!.id;
    await c.query("UPDATE policy_transactions SET status = 'issued', issued_at = now() WHERE id = $1", [txId]);
    await completeCancellation(p, txId, date, Number(p.return_premium ?? 0), user.username, c);
    await audit({ actor: user.username, action: "policy.cancelled", entityType: "policy", entityId: policyId, summary: `Cancelled ${date}: ${p.cancel_reason ?? "notice of cancellation"}` }, c);
  };
  return on ? run(on) : tx(run);
}

/** Cancel (POL-48..51). `pending` records a non-pay notice: the policy cancels on the date unless paid. */
/** Staff record that the carrier went through with a non-pay notice. Not before its date: until then it can still be paid (UX-001). */
export async function confirmNonpayCancellation(policyId: number, user: Pick<User, "username">, on?: Queryable) {
  const run = async (c: Queryable) => {
    const p = await one<{ status: string; cancel_date: string | null }>("SELECT status, cancel_date FROM policies WHERE id = $1 FOR UPDATE", [policyId], c);
    if (p?.status === "pending_cancel" && p.cancel_date && p.cancel_date > todayISO()) throw new Error(`This notice doesn't take effect until ${p.cancel_date}. Until then it can still be paid.`);
    await finalizeCancellation(policyId, user, c);
  };
  await (on ? run(on) : tx(run));
}

export async function cancelPolicy(policyId: number, k: { date: string; reason: string; method: string; returnPremium: number; pending: boolean }, user: Pick<User, "id" | "username">) {
  await tx(async (c) => {
    const p = await one<CancelRow>(`SELECT ${CANCEL_COLS} FROM policies WHERE id = $1 FOR UPDATE`, [policyId], c);
    if (!p) throw new Error("Policy not found");
    // Cancelling twice would credit the client twice (CR-011).
    if (!["active", "bound", "pending_cancel"].includes(p.status)) throw new Error(`A policy that is ${p.status.replace("_", " ")} can't be cancelled.`);
    // A return premium becomes a client credit with a Refund button, so it can't exceed what the term cost (SEC-031).
    const term = await one<{ premium: string }>("SELECT premium FROM policies WHERE id = $1", [policyId], c);
    if (Math.abs(k.returnPremium) > Number(term?.premium)) throw new Error(`The return premium can't be more than the term's premium ($${Number(term?.premium).toFixed(2)}).`);
    await c.query(`UPDATE policies SET status = $2, cancel_date = $3, cancel_reason = $4, cancel_method = $5, return_premium = $6, updated_at = now() WHERE id = $1`,
      [policyId, k.pending ? "pending_cancel" : "cancelled", k.date, k.reason, k.method, k.returnPremium || null]);
    const description = `${k.pending ? "Notice of cancellation" : "Cancelled"}: ${k.reason} (${k.method})`;
    // An earlier notice becomes this cancellation rather than sitting pending beside it.
    const notice = p.status === "pending_cancel" ? await one<{ id: number }>("SELECT id FROM policy_transactions WHERE policy_id = $1 AND kind = 'cancellation' AND status = 'pending' ORDER BY id DESC LIMIT 1", [policyId], c) : null;
    const t = notice
      ? (await c.query("UPDATE policy_transactions SET status = $2, effective_date = $3, description = $4, premium_change = $5, issued_at = $6 WHERE id = $1",
          [notice.id, k.pending ? "pending" : "issued", k.date, description, -Math.abs(k.returnPremium || 0), k.pending ? null : new Date()]), notice)
      : await one<{ id: number }>(
        `INSERT INTO policy_transactions (policy_id, kind, status, effective_date, description, premium_change, created_by_id, issued_at)
         VALUES ($1,'cancellation',$2,$3,$4,$5,$6,$7) RETURNING id`,
        [policyId, k.pending ? "pending" : "issued", k.date, description, -Math.abs(k.returnPremium || 0), user.id, k.pending ? null : new Date()], c);
    if (!k.pending) await completeCancellation(p, t!.id, k.date, k.returnPremium, user.username, c);
    await audit({ actor: user.username, action: k.pending ? "policy.pending_cancel" : "policy.cancelled", entityType: "policy", entityId: policyId,
      summary: `${k.pending ? "Pending cancellation" : "Cancelled"} ${k.date}: ${k.reason}` }, c);
  });
}

export async function reinstatePolicy(policyId: number, note: string, user: Pick<User, "id" | "username">) {
  await tx(async (c) => {
    const p = await one<{ status: string; client_id: number; policy_number: string; account_manager_id: number | null }>("SELECT status, client_id, policy_number, account_manager_id FROM policies WHERE id = $1 FOR UPDATE", [policyId], c);
    if (!p || !["pending_cancel", "cancelled"].includes(p.status)) throw new Error("Only a cancelled policy or one with a pending cancellation can be reinstated.");
    // The return premium isn't due any more. If it has already gone out, someone has to bill it back (CR-011).
    const credits = await q<{ id: number; invoice_number: string }>(
      `SELECT i.id, i.invoice_number FROM invoices i JOIN policy_transactions t ON t.id = i.transaction_id
        WHERE t.policy_id = $1 AND t.kind = 'cancellation' AND i.total < 0 AND i.status <> 'void'`, [policyId], c);
    for (const cr of credits) {
      if (!(await voidCredit(cr.id, "policy reinstated", user.username, c))) {
        await createActivity({ code: "BILL-INQ", priority: "high", subject: `Bill back return premium: ${p.policy_number} reinstated after ${cr.invoice_number} was refunded`, ownerId: p.account_manager_id, createdById: user.id,
          clientId: p.client_id, policyId, source: "system", autoKey: `reinstate-billback:${cr.id}`, actor: user.username }, c);
      }
    }
    await c.query("UPDATE policies SET status = 'active', cancel_date = NULL, cancel_reason = NULL, cancel_method = NULL, return_premium = NULL, updated_at = now() WHERE id = $1", [policyId]);
    await c.query("UPDATE policy_transactions SET status = 'not_issued' WHERE policy_id = $1 AND kind = 'cancellation' AND status = 'pending'", [policyId]);
    await c.query(`INSERT INTO policy_transactions (policy_id, kind, status, effective_date, description, created_by_id, issued_at)
                   VALUES ($1,'reinstatement','issued',current_date,$2,$3,now())`, [policyId, note || "Reinstated", user.id]);
    await audit({ actor: user.username, action: "policy.reinstated", entityType: "policy", entityId: policyId, summary: note || "Reinstated" }, c);
  });
}

export async function setRenewalStage(policyId: number, stage: string, reason: string | null, user: Pick<User, "username">) {
  await tx(async (c) => {
    const before = await one<{ renewal_stage: string }>("SELECT renewal_stage FROM policies WHERE id = $1", [policyId], c);
    await c.query("UPDATE policies SET renewal_stage = $2, remarket_reason = coalesce($3, remarket_reason), updated_at = now() WHERE id = $1", [policyId, stage, reason]);
    await audit({ actor: user.username, action: "renewal.stage", entityType: "policy", entityId: policyId, summary: `Renewal stage ${before?.renewal_stage} → ${stage}${reason ? `: ${reason}` : ""}`,
      before, after: { renewal_stage: stage } }, c);
  });
}

export type RenewalDraft = { policyNumber: string; effectiveDate: string; termMonths: number; premium: number; commissionPct: number; carrierId: number; billMode: "direct" | "agency" };

/** The default rate for a new term: the carrier's renewal rate if it is staying, its new-business rate on a rewrite (CR-010). */
export async function defaultCommissionPct(carrierId: number, kind: "renewal" | "rewrite", fallback: number, on: Queryable = db): Promise<number> {
  const ca = await one<{ commission_new_pct: string; commission_renewal_pct: string }>("SELECT commission_new_pct, commission_renewal_pct FROM carriers WHERE id = $1", [carrierId], on);
  return Number(kind === "renewal" ? ca?.commission_renewal_pct : ca?.commission_new_pct) || fallback;
}

/** Pre-filled renewal term from the expiring policy (REN-09). */
export async function prepareRenewal(policyId: number): Promise<RenewalDraft> {
  const p = await one<{ policy_number: string; expiration_date: string; term_months: number; premium: string; commission_pct: string; carrier_id: number; bill_mode: "direct" | "agency" }>(
    "SELECT policy_number, expiration_date, term_months, premium, commission_pct, carrier_id, bill_mode FROM policies WHERE id = $1", [policyId]);
  if (!p) throw new Error("Policy not found");
  return { policyNumber: p.policy_number, effectiveDate: p.expiration_date, termMonths: p.term_months, premium: Number(p.premium),
    commissionPct: await defaultCommissionPct(p.carrier_id, "renewal", Number(p.commission_pct)), carrierId: p.carrier_id, billMode: p.bill_mode };
}

/** Terms that ended without continuing (CR-039); an expired one can still be renewed late. */
export const NOT_RENEWABLE = ["cancelled", "lost", "non_renewed"];

/** Create the renewal term (REN-10): copies lines, coverages, schedules, interests and forms; links the terms. */
export async function renewPolicy(policyId: number, d: RenewalDraft, user: Pick<User, "id" | "username">): Promise<number> {
  return tx(async (c) => {
    const p = await one<{ id: number; client_id: number; status: string; renewal_policy_id: number | null; lob: string; wholesaler_id: number | null; is_admitted: boolean;
      payment_plan: string; finance_company_id: number | null; description: string | null; producer_id: number | null; account_manager_id: number | null; premium: string; carrier_id: number }>(
      "SELECT * FROM policies WHERE id = $1 FOR UPDATE", [policyId], c);
    if (!p) throw new Error("Policy not found");
    if (p.renewal_policy_id) throw new Error("This policy has already been renewed.");
    if (NOT_RENEWABLE.includes(p.status)) throw new Error(`A ${p.status.replace("_", "-")} policy can't be renewed. Write a new policy instead.`);
    const lines = (await q<{ lob: string }>("SELECT lob FROM policy_lines WHERE policy_id = $1", [policyId], c)).map((l) => l.lob);
    const coverages = await q<CoverageInput>("SELECT lob, code, description, limit_text, deductible_text, premium FROM coverages WHERE policy_id = $1", [policyId], c);
    const ratio = Number(p.premium) ? d.premium / Number(p.premium) : 1;
    const id = await createPolicy({
      clientId: p.client_id, policyNumber: d.policyNumber, carrierId: d.carrierId, wholesalerId: p.wholesaler_id, lob: p.lob, lines,
      effectiveDate: d.effectiveDate, termMonths: d.termMonths, premium: d.premium, commissionPct: d.commissionPct, billMode: d.billMode,
      isAdmitted: p.is_admitted, paymentPlan: p.payment_plan, financeCompanyId: p.finance_company_id, description: p.description,
      producerId: p.producer_id, accountManagerId: p.account_manager_id, status: "active", newRenewal: d.carrierId === p.carrier_id ? "renewal" : "rewrite",
      priorPolicyId: policyId, coverages: coverages.map((cv) => ({ ...cv, premium: cv.premium != null ? Math.round(Number(cv.premium) * ratio) : null })),
    }, user, c);
    await c.query("INSERT INTO policy_items (policy_id, item_id) SELECT $2, item_id FROM policy_items WHERE policy_id = $1", [policyId, id]);
    await c.query("INSERT INTO additional_interests (policy_id, interest_id, role, loan_number) SELECT $2, interest_id, role, loan_number FROM additional_interests WHERE policy_id = $1", [policyId, id]);
    await c.query("INSERT INTO policy_forms (policy_id, form_number, edition, description) SELECT $2, form_number, edition, description FROM policy_forms WHERE policy_id = $1", [policyId, id]);
    await c.query("UPDATE policies SET renewal_policy_id = $2, renewal_stage = 'renewed', updated_at = now() WHERE id = $1", [policyId, id]);
    // Close the open renewal work on the expiring term.
    await c.query(`UPDATE activities SET status = 'done', outcome = 'Renewed', completed_at = now(), completed_by_id = $2
                    WHERE policy_id = $1 AND code IN ('REN-REVIEW','REN-PROC','REN-REMKT') AND status IN ('open','waiting')`, [policyId, user.id]);
    const certs = await one<{ n: number }>(
      "SELECT count(DISTINCT cp.certificate_id)::int AS n FROM certificate_policies cp JOIN certificates ce ON ce.id = cp.certificate_id WHERE cp.policy_id = $1 AND ce.status = 'issued'", [policyId], c);
    if (certs!.n) {
      await createActivity({ code: "COI-RENEW", subject: `Reissue ${certs!.n} certificate(s) for renewed ${d.policyNumber}`, ownerId: p.account_manager_id, createdById: user.id,
        clientId: p.client_id, policyId: id, source: "system", actor: user.username }, c);
    }
    return id;
  });
}

export type TermComparison = {
  premiumBefore: number; premiumAfter: number; change: number; changePct: number; flagged: boolean;
  coverages: { code: string; description: string; before: string; after: string; changed: boolean }[];
};

/** Expiring vs renewal (REN-14): premium change against the remarket threshold, and coverage differences. */
export async function compareTerms(priorId: number, renewalId: number): Promise<TermComparison> {
  const [a, b] = await Promise.all([priorId, renewalId].map((id) => one<{ premium: string }>("SELECT premium FROM policies WHERE id = $1", [id])));
  const threshold = Number((await one<{ value: string }>("SELECT value FROM settings WHERE key = 'remarket_threshold_pct'"))?.value ?? 10);
  const ca = await q<CoverageInput>("SELECT lob, code, description, limit_text, deductible_text, premium FROM coverages WHERE policy_id = $1 ORDER BY code", [priorId]);
  const cb = await q<CoverageInput>("SELECT lob, code, description, limit_text, deductible_text, premium FROM coverages WHERE policy_id = $1 ORDER BY code", [renewalId]);
  const fmt = (c?: CoverageInput) => (c ? [c.limit_text, c.deductible_text ? `ded ${c.deductible_text}` : null].filter(Boolean).join(" · ") || "included" : "—");
  const keys = [...new Set([...ca, ...cb].map((c) => `${c.lob}:${c.code}`))];
  const before = Number(a?.premium ?? 0), after = Number(b?.premium ?? 0);
  const changePct = before ? ((after - before) / before) * 100 : 0;
  return {
    premiumBefore: before, premiumAfter: after, change: after - before, changePct, flagged: changePct >= threshold,
    coverages: keys.map((k) => {
      const x = ca.find((c) => `${c.lob}:${c.code}` === k), y = cb.find((c) => `${c.lob}:${c.code}` === k);
      return { code: (x ?? y)!.code, description: (x ?? y)!.description, before: fmt(x), after: fmt(y), changed: fmt(x) !== fmt(y) };
    }),
  };
}

// A pending endorsement started from a task leaves this in the task's notes, which is what ties the two together (UX-008).
export const endorsementMarker = (txId: number) => `Endorsement #${txId} is pending with the carrier.`;

/** The task still waiting on this transaction, so that the carrier's answer can move it on. */
export async function taskWaitingOnTransaction(txId: number, on?: Queryable): Promise<number | null> {
  const t = await one<{ id: number }>(
    `SELECT a.id FROM activities a JOIN activity_notes n ON n.activity_id = a.id
      WHERE n.kind = 'system' AND strpos(n.body, $1) > 0 AND a.status IN ('open','waiting') ORDER BY a.id DESC LIMIT 1`, [endorsementMarker(txId)], on);
  return t?.id ?? null;
}

/** How long before expiry a term is due for renewing: the longest lead time set, and never less than the pipeline's 120-day view, which links here. */
export async function renewalWindowDays(on: Queryable = db): Promise<number> {
  const lead = (await one<{ value: { personal?: number; commercial_small?: number; commercial_large?: number } }>("SELECT value FROM settings WHERE key = 'renewal_lead_days'", [], on))?.value;
  return Math.max(120, lead?.personal ?? 0, lead?.commercial_small ?? 0, lead?.commercial_large ?? 0);
}

/** What is done and what is left once a term has renewed (UX-035). The certificates are the ones "reissue all" would reissue for this client. */
export async function renewalFollowUp(priorId: number, clientId: number, on?: Queryable) {
  const r = await one<{ tasks: number; certificates: number }>(
    `SELECT (SELECT count(*)::int FROM activities WHERE policy_id = $1 AND code IN ('REN-REVIEW','REN-PROC','REN-REMKT') AND status = 'done' AND outcome = 'Renewed') AS tasks,
            (SELECT count(DISTINCT ce.id)::int FROM certificates ce JOIN certificate_policies cp ON cp.certificate_id = ce.id JOIN policies p ON p.id = cp.policy_id JOIN policies n ON n.id = p.renewal_policy_id
              WHERE ce.client_id = $2 AND ce.status = 'issued' AND ce.holder_id IS NOT NULL AND n.status IN ('active','bound','pending_cancel') AND n.expiration_date >= current_date) AS certificates`, [priorId, clientId], on);
  return r!;
}
