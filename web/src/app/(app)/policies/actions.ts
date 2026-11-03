"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkPolicyAI } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { NEXT_TASK } from "@/components/ui";
import { db, one, q } from "@/lib/db";
import { addDays, todayISO, whenDate } from "@/lib/format";
import { rejected, type FormState } from "@/lib/form-state";
import { setPolicyNumber, cancelPolicy, confirmNonpayCancellation, createPolicy, defaultCommissionPct, endorsementMarker, endorsePolicy, issueTransaction, markIssued, recordPolicyCheck, reinstatePolicy, renewPolicy, setRenewalStage, taskWaitingOnTransaction, type CoverageInput } from "@/lib/policies";
import { lobLabel } from "@/lib/ref";
import { requirePerm, type User, mayActOn } from "@/lib/user";
import { completeLinkedTask, completeTask, resumeTask, setWaiting } from "@/lib/work";

const go = (path: string, key: "msg" | "error", text: string): never => { revalidatePath("/", "layout"); redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`); };
const n = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(/[$,]/g, "")) || 0;

/** If the action was started from a task, close that task with what was done. Says whether it did. */
async function closeTask(f: FormData, outcome: string): Promise<boolean> {
  const taskId = Number(f.get("task_id"));
  if (!taskId) return false;
  return completeLinkedTask(taskId, await requirePerm("write"), outcome);
}

/** The flash after a task shortcut: when the task closed, it offers the way on (UX-022). */
const finished = (msg: string, closed: boolean) => (closed ? `${msg}. The task is closed. ${NEXT_TASK}` : msg);

const CARRIER_FOLLOW_UP_DAYS = 5;

/** The endorsement isn't done until the carrier issues it, so the task it came from waits for that (UX-008). Returns the follow-up date. */
async function waitOnCarrier(f: FormData, u: User, txId: number): Promise<string | null> {
  const taskId = Number(f.get("task_id"));
  if (!taskId) return null;
  const t = await one<{ status: string; owner_id: number | null }>("SELECT status, owner_id FROM activities WHERE id = $1", [taskId]);
  if (!t || (t.status !== "open" && t.status !== "waiting") || !mayActOn(u, t.owner_id)) return null;
  const until = addDays(todayISO(), CARRIER_FOLLOW_UP_DAYS);
  await setWaiting(taskId, u, "carrier", until, endorsementMarker(txId));
  return until;
}

export async function createPolicyAction(_: FormState, f: FormData): Promise<FormState> {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id"));
  const lob = String(f.get("lob"));
  const covs: CoverageInput[] = [];
  for (let i = 0; i < 8; i++) {
    const d = String(f.get(`cov_desc_${i}`) ?? "").trim();
    if (d) covs.push({ lob, code: `C${i + 1}`, description: d, limit_text: String(f.get(`cov_limit_${i}`) ?? "").trim() || null, deductible_text: String(f.get(`cov_ded_${i}`) ?? "").trim() || null });
  }
  try {
    const carrier = await one<{ admitted: boolean; commission_new_pct: string }>("SELECT admitted, commission_new_pct FROM carriers WHERE id = $1", [Number(f.get("carrier_id"))]);
    const id = await createPolicy({
      clientId, policyNumber: String(f.get("policy_number") ?? "").trim() || `PENDING-${Date.now().toString().slice(-6)}`, carrierId: Number(f.get("carrier_id")),
      wholesalerId: Number(f.get("wholesaler_id")) || null, lob, lines: f.getAll("lines").map(String).filter(Boolean),
      effectiveDate: String(f.get("effective_date")), termMonths: Number(f.get("term_months") || 12), premium: n(f, "premium"),
      commissionPct: n(f, "commission_pct") || Number(carrier?.commission_new_pct ?? 12), billMode: f.get("bill_mode") === "agency" ? "agency" : "direct",
      isAdmitted: carrier?.admitted ?? true, paymentPlan: String(f.get("payment_plan") || "annual"), financeCompanyId: Number(f.get("finance_company_id")) || null,
      description: String(f.get("description") ?? "").trim() || null, status: f.get("status") === "bound" ? "bound" : "active",
      binderNumber: String(f.get("binder_number") ?? "").trim() || null, binderExpires: String(f.get("binder_expires") ?? "") || null,
      opportunityId: Number(f.get("opportunity_id")) || null, coverages: covs,
    }, u);
    if (f.get("opportunity_id")) await db.query("UPDATE opportunities SET stage = 'won', won_policy_id = $2, closed_at = now() WHERE id = $1", [Number(f.get("opportunity_id")), id]);
    return go(`/policies/${id}`, "msg", "Policy created. A policy check task is on the account manager's queue.");
  } catch (err) {
    if ((err as Error).message?.startsWith("NEXT_REDIRECT")) throw err;
    return rejected(f, (err as Error).message);
  }
}

export async function endorseAction(_: FormState, f: FormData): Promise<FormState> {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const description = String(f.get("description") ?? "").trim();
  const issueNow = f.get("issue_now") === "on";
  if (!description) return rejected(f, "Describe the change.");
  let txId: number;
  try {
    txId = await endorsePolicy(id, { effectiveDate: String(f.get("effective_date")), description, premiumChange: n(f, "premium_change") * (f.get("sign") === "-" ? -1 : 1), issueNow }, u);
  } catch (err) {
    return rejected(f, (err as Error).message);
  }
  if (issueNow) return go(`/policies/${id}`, "msg", finished("Endorsement issued", await closeTask(f, `Endorsement: ${description}`)));
  const until = await waitOnCarrier(f, u, txId);
  return go(`/policies/${id}`, "msg", until ? `Endorsement pending. The task waits on the carrier until ${whenDate(until)}. ${NEXT_TASK}` : "Endorsement recorded — pending the carrier's confirmation");
}

export async function issueTxAction(f: FormData) {
  const u = await requirePerm("write");
  const txId = Number(f.get("tx_id")), issued = f.get("issued") === "1";
  try {
    await issueTransaction(txId, issued, u);
  } catch (err) {
    go(`/policies/${Number(f.get("id"))}`, "error", (err as Error).message);
  }
  // The carrier has answered: a task that was waiting on this moves on either way.
  const taskId = await taskWaitingOnTransaction(txId);
  if (taskId && issued) await completeTask(taskId, u, "Carrier issued the endorsement");
  if (taskId && !issued) await resumeTask(taskId, u);
  go(`/policies/${Number(f.get("id"))}`, "msg", issued ? finished("Issued", !!taskId) : taskId ? "Marked not issued. The task is back in the queue." : "Marked not issued");
}

export async function policyNumberAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  try {
    await setPolicyNumber(id, String(f.get("new_number") ?? ""), u);
  } catch (err) {
    go(`/policies/${id}`, "error", (err as Error).message);
  }
  go(`/policies/${id}`, "msg", "Policy number updated");
}

export async function markIssuedAction(f: FormData) {
  const u = await requirePerm("write");
  try {
    await markIssued(Number(f.get("id")), u, String(f.get("new_number") ?? ""));
  } catch (err) {
    go(`/policies/${Number(f.get("id"))}`, "error", (err as Error).message);
  }
  go(`/policies/${Number(f.get("id"))}`, "msg", "Carrier policy received — policy is in force");
}

export async function cancelAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const pending = f.get("pending") === "on";
  try {
    await cancelPolicy(id, { date: String(f.get("cancel_date")), reason: String(f.get("reason")), method: String(f.get("method") || "Pro rata"), returnPremium: n(f, "return_premium"), pending }, u);
  } catch (err) {
    // Back to the same form with the task still attached, so a corrected save closes it (UX-009).
    const task = f.get("task_id") ? `&task=${f.get("task_id")}` : "";
    go(`/policies/${id}?action=${f.get("from_nonpay") ? "nonpay" : "cancel"}${task}`, "error", (err as Error).message);
  }
  const closed = await closeTask(f, pending ? "Non-pay notice recorded" : `Cancelled: ${String(f.get("reason"))}`);
  go(`/policies/${id}`, "msg", finished(pending ? "Pending cancellation recorded — reminders will follow" : "Policy cancelled", closed));
}

export async function confirmNonpayAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  try {
    await confirmNonpayCancellation(id, u);
  } catch (err) {
    go(`/policies/${id}`, "error", (err as Error).message);
  }
  const closed = await closeTask(f, "Carrier cancelled for non-payment");
  go(`/policies/${id}`, "msg", finished("Policy cancelled for non-payment", closed));
}

export async function reinstateAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  try {
    await reinstatePolicy(id, String(f.get("note") ?? "").trim(), u);
  } catch (err) {
    go(`/policies/${id}`, "error", (err as Error).message);
  }
  const closed = await closeTask(f, "Reinstated — payment received");
  go(`/policies/${id}`, "msg", finished("Policy reinstated", closed));
}

export async function renewAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  try {
    // Moving carriers without touching the suggested rate means the new carrier's new-business rate, not the old carrier's renewal rate (CR-010).
    const carrierId = Number(f.get("carrier_id"));
    const rewrite = carrierId !== Number(f.get("draft_carrier_id")) && String(f.get("commission_pct")) === String(f.get("draft_commission_pct"));
    const commissionPct = rewrite ? await defaultCommissionPct(carrierId, "rewrite", n(f, "commission_pct")) : n(f, "commission_pct");
    const newId = await renewPolicy(id, { policyNumber: String(f.get("policy_number")).trim(), effectiveDate: String(f.get("effective_date")), termMonths: Number(f.get("term_months") || 12),
      premium: n(f, "premium"), commissionPct, carrierId, billMode: f.get("bill_mode") === "agency" ? "agency" : "direct" }, u);
    go(`/policies/${newId}?tab=renewal`, "msg", "Renewal term created. Renewal tasks on the expiring term were closed.");
  } catch (err) {
    if ((err as Error).message?.startsWith("NEXT_REDIRECT")) throw err;
    go(`/policies/${id}?tab=renewal`, "error", (err as Error).message);
  }
}

export async function renewalStageAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const stage = String(f.get("stage"));
  await setRenewalStage(id, stage, String(f.get("reason") ?? "").trim() || null, u);
  if (stage === "lost" || stage === "non_renewed") {
    await db.query(`UPDATE activities SET status = 'done', outcome = $2, completed_at = now(), completed_by_id = $3 WHERE policy_id = $1 AND code IN ('REN-REVIEW','REN-PROC','REN-REMKT') AND status IN ('open','waiting')`,
      [id, stage === "lost" ? "Renewal lost" : "Carrier non-renewed", u.id]);
  }
  if (stage === "remarketing") {
    const p = await one<{ client_id: number; policy_number: string; lob: string; account_manager_id: number | null; name: string }>("SELECT p.client_id, p.policy_number, p.lob, p.account_manager_id, c.name FROM policies p JOIN clients c ON c.id = p.client_id WHERE p.id = $1", [id]);
    const { createActivity } = await import("@/lib/work");
    await createActivity({ code: "REN-REMKT", subject: `Remarket ${p!.name} ${lobLabel(p!.lob)} ${p!.policy_number}`, description: String(f.get("reason") ?? "") || null, ownerId: p!.account_manager_id ?? u.id,
      createdById: u.id, clientId: p!.client_id, policyId: id, source: "manual", autoKey: `ren-remkt:${id}`, actor: u.username });
  }
  go(`/policies/${id}?tab=renewal`, "msg", "Renewal stage updated");
}

export async function policyCheckAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const file = f.get("file");
  const manual = String(f.get("result") ?? "").trim();
  let summary = manual;
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.type !== "application/pdf") go(`/policies/${id}?tab=check`, "error", "Upload the carrier's policy as a PDF.");
    const p = await one<{ policy_number: string; client: string; carrier: string; effective_date: string; expiration_date: string; premium: string; address: string }>(
      `SELECT p.policy_number, c.name AS client, ca.name AS carrier, p.effective_date, p.expiration_date, p.premium, concat_ws(', ', c.address1, c.city, c.state, c.zip) AS address
         FROM policies p JOIN clients c ON c.id = p.client_id JOIN carriers ca ON ca.id = p.carrier_id WHERE p.id = $1`, [id]);
    const covs = await q<{ description: string; limit_text: string | null; deductible_text: string | null }>("SELECT description, limit_text, deductible_text FROM coverages WHERE policy_id = $1", [id]);
    const items = await q<{ label: string }>("SELECT i.label FROM policy_items pi JOIN insured_items i ON i.id = pi.item_id WHERE pi.policy_id = $1", [id]);
    const ints = await q<{ name: string; role: string }>("SELECT oi.name, ai.role FROM additional_interests ai JOIN other_interests oi ON oi.id = ai.interest_id WHERE ai.policy_id = $1", [id]);
    const record = [`Named insured: ${p!.client}`, `Mailing address: ${p!.address}`, `Policy number: ${p!.policy_number}`, `Carrier: ${p!.carrier}`, `Term: ${p!.effective_date} to ${p!.expiration_date}`, `Premium: $${p!.premium}`,
      "Coverages:", ...covs.map((c) => `- ${c.description}: ${c.limit_text ?? ""}${c.deductible_text ? `, deductible ${c.deductible_text}` : ""}`), "Scheduled items:", ...items.map((i) => `- ${i.label}`),
      "Additional interests:", ...ints.map((i) => `- ${i.role}: ${i.name}`)].join("\n");
    const r = await checkPolicyAI(Buffer.from(await file.arrayBuffer()), record);
    if (!r) go(`/policies/${id}?tab=check`, "error", "AI policy check needs ANTHROPIC_API_KEY (or the request failed). Record the check manually below.");
    summary = r!.overall === "matches" ? `Claude: policy matches the agency record. ${r!.summary}` : `Claude found ${r!.discrepancies.length} discrepanc${r!.discrepancies.length === 1 ? "y" : "ies"}: ${r!.discrepancies.map((d) => `${d.field} (${d.severity}): record "${d.ams_value}" vs policy "${d.document_value}". ${d.note}`).join(" | ")}`;
    const { createHash } = await import("node:crypto");
    const data = Buffer.from(await file.arrayBuffer());
    const fr = await one<{ id: number }>("INSERT INTO files (sha256, mime, size, data) VALUES ($1,$2,$3,$4) RETURNING id", [createHash("sha256").update(data).digest("hex"), file.type, data.length, data]);
    const pc = await one<{ client_id: number }>("SELECT client_id FROM policies WHERE id = $1", [id]);
    await db.query("INSERT INTO documents (client_id, policy_id, folder, title, filename, mime, size, file_id, uploaded_by_id) VALUES ($1,$2,'Policy',$3,$4,$5,$6,$7,$8)", [pc!.client_id, id, `Carrier policy — ${file.name}`, file.name, file.type, data.length, fr!.id, u.id]);
  }
  if (!summary) go(`/policies/${id}?tab=check`, "error", "Upload the policy PDF or write what you checked.");
  await recordPolicyCheck(id, u, summary);
  const t = await one<{ id: number; client_id: number | null }>("SELECT id, client_id FROM activities WHERE policy_id = $1 AND code = 'POL-CHECK' AND status IN ('open','waiting') ORDER BY id LIMIT 1", [id]);
  if (t) await db.query("INSERT INTO activity_notes (activity_id, client_id, author_id, kind, body) VALUES ($1,$2,$3,'note',$4)", [t.id, t.client_id, u.id, summary]);
  await audit({ actor: u.username, action: "policy.check_recorded", entityType: "policy", entityId: id, summary: summary.slice(0, 200) });
  go(`/policies/${id}?tab=check`, "msg", "Policy check recorded");
}

export async function addInterestAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  let interestId = Number(f.get("interest_id")) || null;
  const newName = String(f.get("new_name") ?? "").trim();
  if (!interestId && newName) interestId = (await one<{ id: number }>("INSERT INTO other_interests (name, kind) VALUES ($1,$2) RETURNING id", [newName, String(f.get("kind") || "mortgagee")]))!.id;
  if (!interestId) go(`/policies/${id}?tab=interests`, "error", "Pick or name the interest.");
  await db.query("INSERT INTO additional_interests (policy_id, interest_id, role, loan_number) VALUES ($1,$2,$3,$4)", [id, interestId, String(f.get("role") || "Additional insured"), String(f.get("loan_number") ?? "").trim() || null]);
  await audit({ actor: u.username, action: "policy.interest_added", entityType: "policy", entityId: id, summary: `Added ${f.get("role")}` });
  go(`/policies/${id}?tab=interests`, "msg", "Interest added (endorse the policy if the carrier must be told)");
}

export async function removeInterestAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  await db.query("DELETE FROM additional_interests WHERE id = $1 AND policy_id = $2", [Number(f.get("ai_id")), id]);
  await audit({ actor: u.username, action: "policy.interest_removed", entityType: "policy", entityId: id, summary: "Removed an additional interest" });
  go(`/policies/${id}?tab=interests`, "msg", "Interest removed");
}

export async function saveCoverageAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const covId = Number(f.get("cov_id")) || null;
  const vals = [String(f.get("description") ?? "").trim(), String(f.get("limit_text") ?? "").trim() || null, String(f.get("deductible_text") ?? "").trim() || null];
  if (!vals[0]) go(`/policies/${id}?tab=coverages`, "error", "A coverage needs a description.");
  if (covId) await db.query("UPDATE coverages SET description = $3, limit_text = $4, deductible_text = $5 WHERE id = $1 AND policy_id = $2", [covId, id, ...vals]);
  else await db.query("INSERT INTO coverages (policy_id, lob, code, description, limit_text, deductible_text) SELECT $1, lob, 'ADD', $2, $3, $4 FROM policies WHERE id = $1", [id, ...vals]);
  await audit({ actor: u.username, action: "policy.coverage_saved", entityType: "policy", entityId: id, summary: `${covId ? "Updated" : "Added"} coverage ${vals[0]}` });
  go(`/policies/${id}?tab=coverages`, "msg", "Coverage saved");
}

export async function linkItemsAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const ids = f.getAll("item_ids").map(Number).filter(Boolean);
  await db.query("DELETE FROM policy_items WHERE policy_id = $1", [id]);
  for (const i of ids) await db.query("INSERT INTO policy_items (policy_id, item_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, i]);
  await audit({ actor: u.username, action: "policy.schedule_updated", entityType: "policy", entityId: id, summary: `${ids.length} scheduled item(s)` });
  go(`/policies/${id}?tab=schedule`, "msg", "Schedule updated");
}
