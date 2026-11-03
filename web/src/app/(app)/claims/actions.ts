"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { NEXT_TASK } from "@/components/ui";
import { audit } from "@/lib/audit";
import { notifyOtherPolicies } from "@/lib/claims";
import { db, nextNumber, one, tx, q } from "@/lib/db";
import { addDays, todayISO } from "@/lib/format";
import { requirePerm, type User } from "@/lib/user";
import { completeLinkedTask, completeTask, createActivity } from "@/lib/work";

const go = (path: string, msg: string): never => { revalidatePath("/", "layout"); redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`); };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

export async function createClaimAction(f: FormData) {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id"));
  const { id, notified } = await tx(async (c) => {
    const number = await nextNumber("CLM", c);
    const row = await one<{ id: number }>(
      `INSERT INTO claims (claim_number, client_id, policy_id, carrier_claim_number, loss_date, reported_date, kind, description, location, claimant, adjuster_name, adjuster_phone, adjuster_email, submitted_to_carrier_at, created_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [number, clientId, Number(f.get("policy_id")) || null, s(f, "carrier_claim_number"), s(f, "loss_date") ?? todayISO(), todayISO(), s(f, "kind") ?? "Other", s(f, "description") ?? "Loss reported", s(f, "location"), s(f, "claimant"),
        s(f, "adjuster_name"), s(f, "adjuster_phone"), s(f, "adjuster_email"), f.get("reported") === "on" ? new Date() : null, u.id], c);
    const owner = (await one<{ account_manager_id: number | null }>("SELECT account_manager_id FROM clients WHERE id = $1", [clientId], c))?.account_manager_id ?? u.id;
    await createActivity({ code: f.get("reported") === "on" ? "CLAIM-FU" : "CLAIM-FNOL", subject: f.get("reported") === "on" ? `Claim ${number}: confirm adjuster contact` : `Report claim ${number} to the carrier`,
      ownerId: owner, createdById: u.id, clientId, policyId: Number(f.get("policy_id")) || null, claimId: row!.id, dueDate: f.get("reported") === "on" ? addDays(todayISO(), 2) : todayISO(), source: "manual", actor: u.username }, c);
    await audit({ actor: u.username, action: "claim.created", entityType: "claim", entityId: row!.id, summary: `${number} ${s(f, "kind")} loss ${s(f, "loss_date")}` }, c);
    const notified = await notifyOtherPolicies({ id: row!.id, number, clientId, policyId: Number(f.get("policy_id")) || null }, f.getAll("also_notify").map(Number), owner, u, c);
    return { id: row!.id, notified };
  });
  const taskId = Number(f.get("task_id"));
  let closed = false;
  if (taskId) closed = await completeLinkedTask(taskId, u, "Claim recorded");
  go(`/claims/${id}`, `Claim recorded${notified ? `, with ${notified} task${notified === 1 ? "" : "s"} to notify the other carrier${notified === 1 ? "" : "s"}` : ""}${closed ? `. The task is closed. ${NEXT_TASK}` : ""}`);
}

/** Once the carrier has the claim, "Report claim to the carrier" is done (UX-039). */
async function closeReportTasks(claimId: number, u: User) {
  const open = await q<{ id: number }>("SELECT id FROM activities WHERE claim_id = $1 AND code = 'CLAIM-FNOL' AND status IN ('open','waiting')", [claimId]);
  for (const t of open) await completeTask(t.id, u, "Reported to the carrier");
  return open.length;
}

export async function markClaimReportedAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  await db.query("UPDATE claims SET submitted_to_carrier_at = coalesce(submitted_to_carrier_at, now()) WHERE id = $1", [id]);
  await audit({ actor: u.username, action: "claim.reported", entityType: "claim", entityId: id, summary: "Marked reported to the carrier" });
  const closed = await closeReportTasks(id, u);
  go(`/claims/${id}`, closed ? `Marked reported. The task is closed. ${NEXT_TASK}` : "Marked reported");
}

export async function updateClaimAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  await db.query(`UPDATE claims SET carrier_claim_number = $2, adjuster_name = $3, adjuster_phone = $4, adjuster_email = $5, description = coalesce($6, description), claimant = $7,
      submitted_to_carrier_at = CASE WHEN $8 THEN coalesce(submitted_to_carrier_at, now()) ELSE submitted_to_carrier_at END WHERE id = $1`,
    [id, s(f, "carrier_claim_number"), s(f, "adjuster_name"), s(f, "adjuster_phone"), s(f, "adjuster_email"), s(f, "description"), s(f, "claimant"), f.get("reported") === "on"]);
  await audit({ actor: u.username, action: "claim.updated", entityType: "claim", entityId: id, summary: "Claim details updated" });
  const closed = f.get("reported") === "on" ? await closeReportTasks(id, u) : 0;
  go(`/claims/${id}`, closed ? `Saved. The task is closed. ${NEXT_TASK}` : "Saved");
}

export async function closeClaimAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const reopen = f.get("reopen") === "1";
  await db.query("UPDATE claims SET status = $2, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE NULL END WHERE id = $1", [id, reopen ? "open" : "closed"]);
  if (!reopen) await db.query("UPDATE activities SET status = 'done', outcome = 'Claim closed', completed_at = now(), completed_by_id = $2 WHERE claim_id = $1 AND status IN ('open','waiting')", [id, u.id]);
  await audit({ actor: u.username, action: reopen ? "claim.reopened" : "claim.closed", entityType: "claim", entityId: id, summary: `${reopen ? "Reopened" : "Closed"}${s(f, "note") ? `: ${s(f, "note")}` : ""}` });
  go(`/claims/${id}`, reopen ? "Claim reopened" : "Claim closed");
}

export async function followUpAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const cl = await one<{ client_id: number; policy_id: number | null; claim_number: string }>("SELECT client_id, policy_id, claim_number FROM claims WHERE id = $1", [id]);
  await createActivity({ code: "CLAIM-FU", subject: `Claim ${cl!.claim_number} follow-up`, description: s(f, "note"), ownerId: u.id, createdById: u.id, clientId: cl!.client_id, policyId: cl!.policy_id, claimId: id,
    dueDate: addDays(todayISO(), Number(f.get("days") || 5)), source: "manual", actor: u.username });
  go(`/claims/${id}`, "Follow-up scheduled");
}
