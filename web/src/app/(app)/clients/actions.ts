"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { askAccountAI } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { db, nextNumber, one, q, tx } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { rejected } from "@/lib/form-state";
import { requirePerm } from "@/lib/user";
import { createActivity } from "@/lib/work";
import type { ClientDuplicate, ClientFormState } from "./client-form";

const s = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || null; };
const go = (path: string, msg: string): never => { revalidatePath(path); redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`); };
const fail = (path: string, error: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);

const FIELDS = ["name", "kind", "dba", "industry", "naics", "website", "email", "phone", "address1", "address2", "city", "state", "zip", "source", "household", "preferred_channel", "notes"] as const;

function clientValues(f: FormData) {
  const v: Record<string, unknown> = Object.fromEntries(FIELDS.map((k) => [k, s(f, k)]));
  v.kind = v.kind ?? "business";
  v.preferred_channel = v.preferred_channel ?? "email";
  for (const k of ["producer_id", "account_manager_id", "csr_id", "branch_id", "employees", "years_in_business"]) v[k] = Number(f.get(k)) || null;
  v.annual_revenue = Number(f.get("annual_revenue")) || null;
  v.tags = String(f.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  v.do_not_call = f.get("do_not_call") === "on";
  v.email_opt_out = f.get("email_opt_out") === "on";
  return v;
}

export async function createClientAction(_: ClientFormState, f: FormData): Promise<ClientFormState> {
  const u = await requirePerm("write");
  const v = clientValues(f);
  if (!v.name) return rejected(f, "Name is required.");
  const dupes = await q<ClientDuplicate>(
    `SELECT c.id, c.name, c.code, (SELECT count(*)::int FROM policies p WHERE p.client_id = c.id) AS policies FROM clients c
      WHERE lower(c.name) = lower($1) OR (lower(c.email) = lower($2::text) AND $2::text IS NOT NULL) OR (c.phone = $3::text AND $3::text IS NOT NULL) LIMIT 3`, [v.name, v.email, v.phone]);
  if (dupes.length && f.get("confirm_duplicate") !== "on") {
    return { ...rejected(f, `Possible duplicate of ${dupes.map((d) => d.name).join(", ")}.`), duplicates: dupes };
  }
  const id = await tx(async (c) => {
    const code = await nextNumber(String(v.name).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6).padEnd(4, "X"), c);   // CR-017: never collides
    const row = await one<{ id: number }>(
      `INSERT INTO clients (code, name, kind, status, dba, industry, naics, website, email, phone, address1, address2, city, state, zip, source, household, preferred_channel, notes,
         producer_id, account_manager_id, csr_id, branch_id, employees, years_in_business, annual_revenue, tags, do_not_call, email_opt_out)
       VALUES ($1,$2,$3,'prospect',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28) RETURNING id`,
      [code, v.name, v.kind, v.dba, v.industry, v.naics, v.website, v.email, v.phone, v.address1, v.address2, v.city, v.state, v.zip, v.source, v.household, v.preferred_channel, v.notes,
        v.producer_id ?? u.id, v.account_manager_id, v.csr_id, v.branch_id, v.employees, v.years_in_business, v.annual_revenue, v.tags, v.do_not_call, v.email_opt_out], c);
    const first = s(f, "contact_first"), last = s(f, "contact_last");
    if (first && last) await c.query("INSERT INTO contacts (client_id, first_name, last_name, title, email, phone, is_primary, is_billing) VALUES ($1,$2,$3,$4,$5,$6,true,true)",
      [row!.id, first, last, s(f, "contact_title"), s(f, "contact_email") ?? v.email, s(f, "contact_phone") ?? v.phone]);
    await audit({ actor: u.username, action: "client.created", entityType: "client", entityId: row!.id, summary: `Created ${v.name}`, after: v }, c);
    if (f.get("create_lead_task") === "on") {
      await createActivity({ code: "LEAD", subject: `New prospect: ${v.name}`, ownerId: (v.producer_id as number) ?? u.id, createdById: u.id, clientId: row!.id, source: "manual", actor: u.username }, c);
    }
    return row!.id;
  });
  if (f.get("after") === "opportunity") return go(`/sales/new?client=${id}`, "Prospect created. Now describe the opportunity.");
  return go(`/clients/${id}`, "Client created");
}

export async function updateClientAction(_: ClientFormState, f: FormData): Promise<ClientFormState> {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const v = clientValues(f);
  if (!v.name) return rejected(f, "Name is required.");
  const before = await one("SELECT * FROM clients WHERE id = $1", [id]);   // audit() masks dob, drivers_license and fein
  await db.query(
    `UPDATE clients SET name=$2, kind=$3, dba=$4, industry=$5, naics=$6, website=$7, email=$8, phone=$9, address1=$10, address2=$11, city=$12, state=$13, zip=$14, source=$15, household=$16,
       preferred_channel=$17, notes=$18, producer_id=$19, account_manager_id=$20, csr_id=$21, branch_id=$22, employees=$23, years_in_business=$24, annual_revenue=$25, tags=$26,
       do_not_call=$27, email_opt_out=$28, updated_at = now() WHERE id = $1`,
    [id, v.name, v.kind, v.dba, v.industry, v.naics, v.website, v.email, v.phone, v.address1, v.address2, v.city, v.state, v.zip, v.source, v.household, v.preferred_channel, v.notes,
      v.producer_id, v.account_manager_id, v.csr_id, v.branch_id, v.employees, v.years_in_business, v.annual_revenue, v.tags, v.do_not_call, v.email_opt_out]);
  if (f.get("sms_consent") === "on") await db.query("UPDATE clients SET sms_consent_at = coalesce(sms_consent_at, now()) WHERE id = $1", [id]);
  else await db.query("UPDATE clients SET sms_consent_at = NULL WHERE id = $1", [id]);
  await audit({ actor: u.username, action: "client.updated", entityType: "client", entityId: id, summary: `Updated ${v.name}`, before, after: v });
  return go(`/clients/${id}`, "Saved");
}

export async function setClientStatusAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  // Reactivating goes back to what the record shows: an insured if it ever had a policy, otherwise a prospect.
  const status = f.get("status") === "inactive" ? "inactive" : (await one("SELECT 1 FROM policies WHERE client_id = $1 LIMIT 1", [id])) ? "insured" : "prospect";
  await db.query("UPDATE clients SET status = $2, inactive_reason = $3, updated_at = now() WHERE id = $1", [id, status, status === "inactive" ? s(f, "reason") ?? "Inactivated" : null]);
  await audit({ actor: u.username, action: "client.status", entityType: "client", entityId: id, summary: `Status → ${status}` });
  go(`/clients/${id}`, `Client ${status === "inactive" ? "inactivated" : "reactivated"}`);
}

export async function saveContactAction(f: FormData) {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id")), id = Number(f.get("contact_id")) || null;
  const vals = [s(f, "first_name"), s(f, "last_name"), s(f, "title"), s(f, "email"), s(f, "phone"), s(f, "mobile"), f.get("is_primary") === "on", f.get("is_billing") === "on"];
  if (!vals[0] || !vals[1]) fail(`/clients/${clientId}?tab=contacts${id ? `&edit=${id}` : ""}`, "First and last name are required.");
  await tx(async (c) => {
    if (vals[6]) await c.query("UPDATE contacts SET is_primary = false WHERE client_id = $1", [clientId]);
    if (id) await c.query("UPDATE contacts SET first_name=$2, last_name=$3, title=$4, email=$5, phone=$6, mobile=$7, is_primary=$8, is_billing=$9 WHERE id = $1", [id, ...vals]);
    else await c.query("INSERT INTO contacts (client_id, first_name, last_name, title, email, phone, mobile, is_primary, is_billing) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [clientId, ...vals]);
    await audit({ actor: u.username, action: id ? "contact.updated" : "contact.created", entityType: "client", entityId: clientId, summary: `${id ? "Updated" : "Added"} contact ${vals[0]} ${vals[1]}` }, c);
  });
  go(`/clients/${clientId}?tab=contacts`, "Contact saved");
}

export async function deleteContactAction(f: FormData) {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id")), id = Number(f.get("contact_id"));
  await db.query("DELETE FROM contacts WHERE id = $1 AND client_id = $2", [id, clientId]);
  await audit({ actor: u.username, action: "contact.deleted", entityType: "client", entityId: clientId, summary: `Removed contact ${id}` });
  go(`/clients/${clientId}?tab=contacts`, "Contact removed");
}

export async function addItemAction(f: FormData) {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id")), kind = String(f.get("kind")), label = s(f, "label");
  if (!label) fail(`/clients/${clientId}?tab=schedules`, "A description is required.");
  const data: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (k.startsWith("d_") && typeof v === "string" && v.trim()) data[k.slice(2)] = v.trim();
  await db.query("INSERT INTO insured_items (client_id, kind, label, data) VALUES ($1,$2,$3,$4)", [clientId, kind, label, JSON.stringify(data)]);
  await audit({ actor: u.username, action: "item.added", entityType: "client", entityId: clientId, summary: `Added ${kind}: ${label}` });
  go(`/clients/${clientId}?tab=schedules`, "Added to schedule");
}

export async function removeItemAction(f: FormData) {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id")), id = Number(f.get("item_id"));
  await db.query("UPDATE insured_items SET active = false WHERE id = $1 AND client_id = $2", [id, clientId]);
  await audit({ actor: u.username, action: "item.removed", entityType: "client", entityId: clientId, summary: `Removed schedule item ${id}` });
  go(`/clients/${clientId}?tab=schedules`, "Removed from schedule");
}

export async function mergeClientAction(f: FormData) {
  const u = await requirePerm("team");
  const keep = Number(f.get("id")), drop = Number(f.get("merge_id"));
  if (!drop || keep === drop) fail(`/clients/${keep}`, "Pick a different client to merge.");
  await tx(async (c) => {
    const moved: Record<string, number> = {};
    for (const t of ["contacts", "insured_items", "policies", "activities", "activity_notes", "documents", "emails", "certificates", "claims", "invoices", "receipts", "opportunities", "ledger_entries"]) {
      moved[t] = (await c.query(`UPDATE ${t} SET client_id = $1 WHERE client_id = $2`, [keep, drop])).rowCount ?? 0;
    }
    await c.query("UPDATE clients SET status = 'inactive', inactive_reason = $2, name = name || ' (merged)', email = NULL, website = NULL WHERE id = $1", [drop, `Merged into ${keep}`]);
    await audit({ actor: u.username, action: "client.merged", entityType: "client", entityId: keep, summary: `Merged client ${drop} into ${keep}`, after: { moved } }, c);
  });
  go(`/clients/${keep}`, "Clients merged");
}

/** Account Q&A (CRM-13): Claude answers from the account file. */
export async function askAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const question = String(f.get("question") ?? "").trim();
  if (!question) fail(`/clients/${id}`, "Type a question.");
  const c = await one<{ name: string; kind: string; industry: string | null; city: string | null; state: string | null; notes: string | null }>("SELECT name, kind, industry, city, state, notes FROM clients WHERE id = $1", [id]);
  const pol = await q<{ policy_number: string; lob: string; carrier: string; effective_date: string; expiration_date: string; premium: string; status: string; covs: string | null }>(
    `SELECT p.policy_number, p.lob, ca.name AS carrier, p.effective_date, p.expiration_date, p.premium, p.status,
            (SELECT string_agg(cv.description || ': ' || coalesce(cv.limit_text,'') || coalesce(' ded ' || cv.deductible_text,''), '; ') FROM coverages cv WHERE cv.policy_id = p.id) AS covs
       FROM policies p JOIN carriers ca ON ca.id = p.carrier_id WHERE p.client_id = $1 ORDER BY p.expiration_date DESC LIMIT 25`, [id]);
  const acts = await q<{ subject: string; status: string; created_at: Date; outcome: string | null }>("SELECT subject, status, created_at, outcome FROM activities WHERE client_id = $1 ORDER BY created_at DESC LIMIT 40", [id]);
  const claims = await q<{ claim_number: string; kind: string; loss_date: string; status: string; description: string }>("SELECT claim_number, kind, loss_date, status, description FROM claims WHERE client_id = $1", [id]);
  const context = [`Client: ${c?.name} (${c?.kind}, ${c?.industry ?? ""}, ${c?.city}, ${c?.state}). Notes: ${c?.notes ?? "none"}`, `Today: ${todayISO()}`,
    "Policies:", ...pol.map((p) => `- ${p.policy_number} ${p.lob} ${p.carrier} ${p.effective_date}→${p.expiration_date} $${p.premium} ${p.status}. Coverages: ${p.covs ?? "n/a"}`),
    "Claims:", ...claims.map((cl) => `- ${cl.claim_number} ${cl.kind} loss ${cl.loss_date} ${cl.status}: ${cl.description}`),
    "Recent work:", ...acts.map((a) => `- ${new Date(a.created_at).toISOString().slice(0, 10)} ${a.subject} [${a.status}]${a.outcome ? ` → ${a.outcome}` : ""}`)].join("\n");
  const r = await askAccountAI(context, question);
  await audit({ actor: u.username, action: "client.asked", entityType: "client", entityId: id, summary: question.slice(0, 120) });
  if (!r) fail(`/clients/${id}`, "Account Q&A needs ANTHROPIC_API_KEY and the assist turned on in Admin > Settings. Without it, use the tabs on this page.");
  // Kept as a note on the account (not in the URL): the answer can contain client details.
  await db.query("INSERT INTO activity_notes (client_id, author_id, kind, body) VALUES ($1,$2,'system',$3)",
    [id, u.id, `Asked Claude: ${question}\n\n${r!.answer}${r!.sources.length ? `\n\nBased on: ${r!.sources.join(", ")}` : ""}`]);
  go(`/clients/${id}`, "Answer added to the account notes");
}
