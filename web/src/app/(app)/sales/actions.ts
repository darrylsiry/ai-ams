"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { db, one } from "@/lib/db";
import { rejected, type FormState } from "@/lib/form-state";
import { requirePerm } from "@/lib/user";
import { createActivity } from "@/lib/work";

const go = (path: string, msg: string): never => { revalidatePath(path); redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`); };

export async function createOpportunityAction(_: FormState, f: FormData): Promise<FormState> {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id"));
  const name = String(f.get("name") ?? "").trim();
  if (!clientId || !name) return rejected(f, "Pick a client and name the opportunity.");
  const o = await one<{ id: number }>(
    "INSERT INTO opportunities (client_id, name, kind, lines, stage, est_premium, owner_id, target_date, source, notes) VALUES ($1,$2,$3,$4,'lead',$5,$6,$7,$8,$9) RETURNING id",
    [clientId, name, String(f.get("kind") || "new"), f.getAll("lines").map(String), Number(f.get("est_premium")) || null, Number(f.get("owner_id")) || u.id, String(f.get("target_date") || "") || null, String(f.get("source") || "") || null, String(f.get("notes") || "") || null]);
  await createActivity({ code: "QUOTE", subject: `Gather exposures and submit: ${name}`, ownerId: Number(f.get("owner_id")) || u.id, createdById: u.id, clientId, opportunityId: o!.id, source: "manual", actor: u.username });
  await audit({ actor: u.username, action: "opportunity.created", entityType: "opportunity", entityId: o!.id, summary: name });
  return go(`/sales/${o!.id}`, "Opportunity created");
}

export async function stageAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id")), stage = String(f.get("stage"));
  await db.query("UPDATE opportunities SET stage = $2, lost_reason = $3, closed_at = CASE WHEN $2 IN ('won','lost') THEN now() ELSE NULL END WHERE id = $1",
    [id, stage, stage === "lost" ? String(f.get("lost_reason") || "Not specified") : null]);
  if (stage === "lost") await db.query("UPDATE activities SET status = 'cancelled', outcome = 'Opportunity lost', completed_at = now() WHERE opportunity_id = $1 AND status IN ('open','waiting')", [id]);
  await audit({ actor: u.username, action: "opportunity.stage", entityType: "opportunity", entityId: id, summary: `Stage → ${stage}` });
  go(`/sales/${id}`, "Stage updated");
}

export async function addSubmissionAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const carriers = f.getAll("carrier_ids").map(Number).filter(Boolean);
  if (!carriers.length) redirect(`/sales/${id}?error=${encodeURIComponent("Tick at least one market to add.")}`);
  for (const c of carriers) await db.query("INSERT INTO submissions (opportunity_id, carrier_id, status, submitted_at) VALUES ($1,$2,$3,$4)", [id, c, f.get("submitted") === "on" ? "submitted" : "preparing", f.get("submitted") === "on" ? new Date() : null]);
  await db.query("UPDATE opportunities SET stage = CASE WHEN stage IN ('lead','qualifying') THEN 'submitted' ELSE stage END WHERE id = $1", [id]);
  await audit({ actor: u.username, action: "submission.created", entityType: "opportunity", entityId: id, summary: `${carriers.length} market(s) added` });
  go(`/sales/${id}`, `${carriers.length} market(s) added`);
}

export async function updateSubmissionAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id")), subId = Number(f.get("sub_id")), status = String(f.get("status"));
  await db.query(`UPDATE submissions SET status = $2, quoted_premium = $3, declination_reason = $4, notes = coalesce(nullif($5,''), notes),
      submitted_at = coalesce(submitted_at, CASE WHEN $2 <> 'preparing' THEN now() END), responded_at = CASE WHEN $2 IN ('quoted','declined') THEN now() ELSE responded_at END WHERE id = $1`,
    [subId, status, Number(f.get("quoted_premium")) || null, status === "declined" ? String(f.get("declination_reason") || "Declined") : null, String(f.get("notes") ?? "")]);
  if (status === "quoted") await db.query("UPDATE opportunities SET stage = CASE WHEN stage IN ('lead','qualifying','submitted') THEN 'quoted' ELSE stage END WHERE id = $1", [id]);
  await audit({ actor: u.username, action: "submission.updated", entityType: "opportunity", entityId: id, summary: `Submission ${subId} → ${status}` });
  go(`/sales/${id}`, "Submission updated");
}
