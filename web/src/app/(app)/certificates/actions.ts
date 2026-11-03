"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { NEXT_TASK } from "@/components/ui";
import { holderChoiceError, issueCertificate, issueRefused, markCertificateSent, NO_POLICIES, policiesNotInForce, renewCertificates, verifyWording } from "@/lib/certificates";
import { db, one } from "@/lib/db";
import { emailEnabled, isEmailAddress, sendEmail } from "@/lib/email/send";
import type { FormState } from "@/lib/form-state";
import { certificate, documentFilename } from "@/lib/pdf";
import { requirePerm, type User } from "@/lib/user";
import { completeLinkedTask } from "@/lib/work";

const go = (path: string, key: "msg" | "error", text: string): never => { revalidatePath("/", "layout"); redirect(`${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`); };

/** Email the certificate PDF and record the delivery. False, with nothing recorded, when it wasn't accepted. */
async function emailCertificate(id: number, to: string, u: User): Promise<boolean> {
  try {
    const ce = await one<{ cert_number: string; client_name: string; holder: string | null }>(
      "SELECT ce.cert_number, c.name AS client_name, oi.name AS holder FROM certificates ce JOIN clients c ON c.id = ce.client_id LEFT JOIN other_interests oi ON oi.id = ce.holder_id WHERE ce.id = $1", [id]);
    if (!ce) throw new Error("Certificate not found");
    await sendEmail({ from: u, to, subject: `Certificate of insurance ${ce.cert_number}: ${ce.client_name}`,
      text: `Attached is certificate of insurance ${ce.cert_number} for ${ce.client_name}${ce.holder ? `, issued to ${ce.holder}` : ""}.\n\n${u.full_name}`,
      attachments: [{ filename: await documentFilename("certificate", id), content: await certificate(id), contentType: "application/pdf" }] });
  } catch (err) {
    console.error("certificate email failed", err);
    return false;
  }
  await db.query("UPDATE certificates SET delivered_to = $2, delivered_at = now() WHERE id = $1", [id, to]);
  await audit({ actor: u.username, action: "certificate.delivered", entityType: "certificate", entityId: id, summary: `Emailed to ${to}` });
  return true;
}

export async function issueAction(_: FormState, f: FormData): Promise<FormState> {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id"));
  let holderId = Number(f.get("holder_id")) || null;
  const newName = String(f.get("holder_name") ?? "").trim();
  const conflict = await holderChoiceError(holderId, newName);
  if (conflict) return issueRefused(f, conflict, holderId);
  let savedHolder: string | undefined;
  if (!holderId && newName) {
    holderId = (await one<{ id: number }>("INSERT INTO other_interests (name, kind, attention, address1, city, state, zip, email) VALUES ($1,'certificate_holder',$2,$3,$4,$5,$6,$7) RETURNING id",
      [newName, String(f.get("holder_attention") || "") || null, String(f.get("holder_address") || "") || null, String(f.get("holder_city") || "") || null, String(f.get("holder_state") || "") || null, String(f.get("holder_zip") || "") || null, String(f.get("holder_email") || "") || null]))!.id;
    savedHolder = newName;
    revalidatePath("/certificates/new");
  }
  const refuse = (error: string) => issueRefused(f, error, holderId, savedHolder);
  if (!holderId) return refuse("Choose a certificate holder or enter a new one.");
  const policyIds = f.getAll("policy_ids").map(Number).filter(Boolean);
  if (!policyIds.length) return refuse(NO_POLICIES);
  const flags = { additional_insured: f.get("ai") === "on", waiver_of_subrogation: f.get("wos") === "on", primary_noncontributory: f.get("pnc") === "on" };
  const warnings = await verifyWording(policyIds, flags);
  if (warnings.length && f.get("override") !== "on") return refuse(`Check before issuing: ${warnings.join(" ")} Tick "issue anyway" if the carrier has confirmed the endorsement.`);
  const to = String(f.get("delivered_to") ?? "").trim();
  if (to && !isEmailAddress(to)) return refuse("Enter one email address to send the certificate to.");
  const sending = emailEnabled() && !!to;
  let id = 0;
  try {
    // When it will really be emailed, the delivery is recorded only once the mail server accepts it.
    id = await issueCertificate({ clientId, holderId: holderId!, policyIds, description: String(f.get("description") ?? "").trim() || null, deliveredTo: sending ? null : to || null, ...flags }, u);
  } catch (err) {
    return refuse((err as Error).message);
  }
  if (warnings.length) await audit({ actor: u.username, action: "certificate.override", entityType: "certificate", entityId: id, summary: `Issued despite: ${warnings.join(" ")}` });
  if (sending && !(await emailCertificate(id, to, u))) go(`/certificates/${id}`, "error", `Certificate issued, but the email to ${to} was not sent. Any linked task stays open. Use Send again, or send it from your own mailbox.`);
  const taskId = Number(f.get("task_id"));
  let closed = false;
  if (taskId) closed = await completeLinkedTask(taskId, u, sending ? "Certificate issued and delivered" : "Certificate issued; PDF to send manually");
  const number = (await one<{ cert_number: string }>("SELECT cert_number FROM certificates WHERE id = $1", [id]))?.cert_number;
  go(`/certificates/${id}`, "msg", sending ? `Certificate issued and sent to ${to}${closed ? ` — the task is closed. ${NEXT_TASK}` : ""}`
    : closed ? `Certificate issued — the task is closed. ${number} not emailed: open the PDF and send it from Outlook. ${NEXT_TASK}` : `Certificate issued: ${number}. Not emailed: open the PDF and send it from Outlook.`);
  return null;
}

export async function revokeAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  await db.query("UPDATE certificates SET status = 'revoked' WHERE id = $1", [id]);
  await audit({ actor: u.username, action: "certificate.revoked", entityType: "certificate", entityId: id, summary: String(f.get("reason") || "Revoked") });
  go(`/certificates/${id}`, "msg", "Certificate revoked");
}

export async function redeliverAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const to = String(f.get("delivered_to") ?? "").trim();
  if (!isEmailAddress(to)) go(`/certificates/${id}`, "error", "Enter one email address to send the certificate to.");
  const current = await one<{ status: string }>("SELECT status FROM certificates WHERE id = $1", [id]);
  if (current?.status !== "issued") go(`/certificates/${id}`, "error", "Not sent: only a current certificate can be sent.");
  const lapsed = await policiesNotInForce(id);
  if (lapsed.length) go(`/certificates/${id}`, "error", `Not sent: this certificate lists coverage no longer in force: ${lapsed.join(", ")}. Reissue or revoke it.`);
  if (emailEnabled()) {
    if (await emailCertificate(id, to, u)) go(`/certificates/${id}`, "msg", `Sent to ${to}`);
    go(`/certificates/${id}`, "error", `The email to ${to} was not sent. Try again, or send it from your own mailbox.`);
  }
  await markCertificateSent(id, to, u);
  go(`/certificates/${id}`, "msg", `Delivery to ${to} logged as sent by you (email sending needs SMTP_URL)`);
}

export async function renewAllAction(f: FormData) {
  const u = await requirePerm("write");
  const clientId = Number(f.get("client_id"));
  const { reissued: n, held } = await renewCertificates(clientId, u);
  const heldNote = held ? ` ${held} held back with a task: their wording needs checking on the new term.` : "";
  go(`/clients/${clientId}?tab=certificates`, "msg", n ? `Reissued ${n} certificate(s) on the renewed policies. ${emailEnabled() ? "They have not been emailed: send each one from its page" : "Not emailed: open each PDF and send it from Outlook"}.${heldNote}` : held ? `Nothing reissued.${heldNote}` : "No certificates are on renewed policies yet");
}
