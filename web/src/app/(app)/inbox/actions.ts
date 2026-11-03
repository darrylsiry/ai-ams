"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { db, one, tx } from "@/lib/db";
import { confirmEmailReviewed, EmailNeedsClient, emailTask, ignoreEmail, ingestEmail, relinkEmail, retypeEmail } from "@/lib/email/ingest";
import { fromRaw, type Address, type ParsedEmail } from "@/lib/email/parse";
import { emailEnabled, sendEmail } from "@/lib/email/send";
import { authEnabled, can, currentUser, Forbidden, mayActOn, requirePerm } from "@/lib/user";

const go = (path: string, msg: string): never => { revalidatePath("/", "layout"); redirect(`${path}${path.includes("?") ? "&" : "?"}msg=${encodeURIComponent(msg)}`); };

const NOT_YOURS = "That email's task belongs to someone else. Ask them, or a principal, to change it.";
const fail = (path: string, error: string): never => redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(error)}`);

/** Confirm (or correct) the client an email belongs to; its task follows. */
export async function linkClientAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id")), clientId = Number(f.get("client_id")) || null, posted = Number(f.get("policy_id")) || null;
  if (!clientId) fail(`/inbox/${id}`, new EmailNeedsClient().message);
  const task = await emailTask(id);
  if (!mayActOn(u, task.ownerId)) fail(`/inbox/${id}`, NOT_YOURS);
  await tx(async (c) => {
    const e = await one<{ activity_id: number | null; client_id: number | null; to_addrs: string[]; routed_user_id: number | null; forwarded_by_user_id: number | null }>(
      "SELECT activity_id, client_id, to_addrs, routed_user_id, forwarded_by_user_id FROM emails WHERE id = $1", [id], c);
    const policyId = await relinkEmail(id, clientId, posted, c);
    // Email to a shared address went to a fallback owner. Now the client is known, the work goes to their account manager (CR-009);
    // email someone sent to their own alias, or forwarded, stays with them.
    const routed = e?.routed_user_id ? await one<{ inbox_alias: string }>("SELECT inbox_alias FROM users WHERE id = $1", [e.routed_user_id], c) : null;
    const personal = !!e?.forwarded_by_user_id || (e?.to_addrs ?? []).some((a) => { const local = a.split("@")[0]; return !!routed && (local.includes("+") ? local.split("+")[1] : local).toLowerCase() === routed.inbox_alias.toLowerCase(); });
    const am = !personal && clientId ? (await one<{ account_manager_id: number | null }>("SELECT account_manager_id FROM clients WHERE id = $1", [clientId], c))?.account_manager_id ?? null : null;
    if (e?.activity_id && !task.shared) await c.query("UPDATE activities SET client_id = $2, policy_id = CASE WHEN client_id IS NOT DISTINCT FROM $2 THEN coalesce($3, policy_id) ELSE $3 END, owner_id = coalesce($4, owner_id), updated_at = now() WHERE id = $1", [e.activity_id, clientId, policyId, am]);
    await audit({ actor: u.username, action: "email.linked", entityType: "email", entityId: id, summary: `Linked to client ${clientId}${am ? `; task moved to their account manager (user ${am})` : ""}`, before: { client_id: e?.client_id }, after: { client_id: clientId, owner_id: am ?? undefined } }, c);
  });
  go(`/inbox/${id}`, task.shared ? "Client confirmed. Its task is shared with another email, so the task stayed where it was." : "Client confirmed — the task moved with it");
}

/** Change what kind of work the email is. */
export async function retypeAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id")), code = String(f.get("code"));
  const e = await emailTask(id);
  if (!mayActOn(u, e.ownerId)) fail(`/inbox/${id}`, NOT_YOURS);
  if (e.shared) fail(`/inbox/${id}`, "This email shares its task with another email, so its type can't change here. Change the task itself.");
  const ac = await one<{ label: string; default_priority: string }>("SELECT label, default_priority FROM activity_codes WHERE code = $1", [code]);
  if (e.activityId && ac) {
    await db.query("UPDATE activities SET code = $2, priority = $3, subject = coalesce(nullif($4,''), subject), updated_at = now() WHERE id = $1", [e.activityId, code, ac.default_priority, String(f.get("subject") ?? "").trim()]);
    await retypeEmail(id, code);
    await audit({ actor: u.username, action: "email.retyped", entityType: "email", entityId: id, summary: `Task type changed to ${ac.label}` });
  }
  go(`/inbox/${id}`, "Task type updated");
}

export async function reviewedAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const back = f.get("back") === "list" ? "/inbox" : `/inbox/${id}`;
  try {
    await tx(async (c) => {
      const held = await confirmEmailReviewed(id, c);
      await audit({ actor: u.username, action: "email.reviewed", entityType: "email", entityId: id, summary: held ? "Marked reviewed; held attachments filed on the client" : "Marked reviewed" }, c);
    });
  } catch (err) {
    if (err instanceof EmailNeedsClient) fail(back, err.message);
    throw err;
  }
  go(back, "Marked reviewed");
}

export async function ignoreAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  await tx(async (c) => {
    if (!mayActOn(u, (await emailTask(id, c)).ownerId)) throw new Forbidden("That email's task belongs to someone else.");
    const shared = await ignoreEmail(id, u, c);
    await audit({ actor: u.username, action: "email.ignored", entityType: "email", entityId: id, summary: shared ? "Ignored; its shared task stays open" : "Ignored; its task was cancelled" }, c);
  });
  go("/inbox", "Ignored");
}

/** Send a reply and record it on the client. Without SMTP_URL it is only recorded, and the message says so. */
export async function replyAction(f: FormData) {
  const u = await requirePerm("write");
  const id = Number(f.get("id"));
  const body = String(f.get("body") ?? "").trim();
  const e = await one<{ client_id: number | null; activity_id: number | null; subject: string; original_from_addr: string | null; from_addr: string; message_id: string }>("SELECT client_id, activity_id, subject, original_from_addr, from_addr, message_id FROM emails WHERE id = $1", [id]);
  if (!e || !body) fail(`/inbox/${id}`, "Nothing to send");
  const to = e!.original_from_addr ?? e!.from_addr;
  const subject = `Re: ${e!.subject.replace(/^(re|fwd?|fw):\s*/i, "")}`;
  const sending = emailEnabled();
  let messageId = `<out-${crypto.randomUUID()}@siryous-ams>`;
  if (sending) {
    try {
      // A forward's Message-ID belongs to the staff member's forward, not to the client's thread.
      messageId = await sendEmail({ from: u, to, subject, text: body, inReplyTo: e!.original_from_addr ? null : e!.message_id });
    } catch (err) {
      console.error("reply failed", err);
      // The redirect loses the form, so the text waits on the task for another try.
      await db.query("INSERT INTO activity_notes (activity_id, client_id, author_id, kind, body) VALUES ($1,$2,$3,'note',$4)", [e!.activity_id, e!.client_id, u.id, `Reply to ${to} was NOT sent: ${body}`]);
      redirect(`/inbox/${id}?error=${encodeURIComponent(`The reply to ${to} was not sent. Your text is saved in the task notes. Try again, or send it from your own mailbox.`)}`);
    }
  }
  await db.query(`INSERT INTO emails (message_id, direction, from_addr, from_name, to_addrs, subject, body_text, client_id, status, source, received_at, routed_user_id)
                  VALUES ($1,'outbound',$2,$3,$4,$5,$6,$7,'actioned','outbound',now(),$8)`,
    [messageId, `${u.inbox_alias}@${process.env.INBOUND_EMAIL_DOMAIN || "siryous.local"}`, u.full_name, [to], subject, body, e!.client_id, u.id]);
  await db.query("INSERT INTO activity_notes (activity_id, client_id, author_id, kind, body) VALUES ($1,$2,$3,'email_out',$4)", [e!.activity_id, e!.client_id, u.id, `Reply to ${to}: ${body}`]);
  go(`/inbox/${id}`, sending ? `Reply sent to ${to}` : "Reply logged (sending turns on when SMTP_URL is configured)");
}

/** The test-intake form: build an email and run it through the same pipeline as the webhook. */
export async function simulateAction(f: FormData) {
  const u = await currentUser();
  // It can inject any sender, recipient and attachment, so outside local development it is an administrator's tool (SEC-005).
  if (authEnabled() && !can(u, "admin")) throw new Forbidden("Test email intake is for administrators.");
  const domain = process.env.INBOUND_EMAIL_DOMAIN || "amsinbox.siryous.app";
  const file = f.get("eml");
  let email: ParsedEmail;
  if (file && typeof file !== "string" && file.size > 0) {
    email = await fromRaw(Buffer.from(await file.arrayBuffer()));
    if (!email.to.length) email.to = [{ addr: `${u.inbox_alias}@${domain}`, name: null }];
  } else {
    const fromAddr = String(f.get("from_addr") ?? "").trim().toLowerCase();
    const fromName = String(f.get("from_name") ?? "").trim() || null;
    const to: Address = { addr: String(f.get("to") || `${u.inbox_alias}@${domain}`), name: null };
    const subject = String(f.get("subject") ?? "").trim();
    const body = String(f.get("body") ?? "");
    const forwarded = f.get("forwarded") === "on";
    const attachments = [];
    const att = f.get("attachment");
    if (att && typeof att !== "string" && att.size > 0) attachments.push({ filename: att.name, mime: att.type || "application/octet-stream", data: Buffer.from(await att.arrayBuffer()) });
    email = forwarded
      ? { messageId: null, from: { addr: u.email, name: u.full_name }, senderVerified: true, to: [to], cc: [], subject: `Fwd: ${subject}`, date: new Date(), html: null, attachments,
          text: `${String(f.get("note") ?? "").trim()}\n\n---------- Forwarded message ---------\nFrom: ${fromName ?? ""} <${fromAddr}>\nDate: ${new Date().toUTCString()}\nSubject: ${subject}\nTo: ${u.full_name} <${u.email}>\n\n${body}` }
      : { messageId: null, from: { addr: fromAddr, name: fromName }, to: [to], cc: [], subject, text: body, html: null, date: new Date(), attachments };
  }
  email.messageId = email.messageId ?? `<sim-${crypto.randomUUID()}@siryous-ams>`;
  const r = await ingestEmail(email, { source: "simulator", actor: u.username });
  go(r.activityId ? `/tasks/${r.activityId}` : `/inbox/${r.emailId}`,
    `Email received → ${r.classification.activity_code} task for ${r.routedTo ?? "the account manager"} (${r.classifiedBy === "ai" ? "classified by Claude" : "classified by rules"}${r.match.method ? `, client matched by ${r.match.method}` : ", no client match"})`);
}
