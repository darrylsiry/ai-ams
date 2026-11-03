import { createHash } from "node:crypto";
import { aiEnabled, classifyEmailAI } from "../ai";
import { audit } from "../audit";
import { db, one, q, tx, type Queryable } from "../db";
import { todayISO } from "../format";
import { storedMime } from "../http";
import { DEFAULTS, getSetting } from "../settings";
import type { User } from "../user";
import { createActivity, noteOnOpenNonpay, systemNote } from "../work";
import { detectForward, newContent, stripSubjectPrefixes, type Address, type ParsedEmail } from "./parse";
import { classifyByRules, dueDateFor, policyNumberCandidates, type Classification } from "./rules";

// Email to action item (WRK-20, WRK-21). An email reaches the AMS by being forwarded or copied to
//   <alias>@INBOUND_EMAIL_DOMAIN   (each user's personal inbox alias, e.g. mrivera@amsinbox.siryous.app)
//   service@INBOUND_EMAIL_DOMAIN   (shared: routed to the matched client's account manager)
// The pipeline: who it is for (route) → which client and policy it concerns (match) → what has to be
// done (classify: Claude when configured, keyword rules otherwise) → one task in that person's queue,
// with the email and its attachments filed on the client.

export const SHARED_ALIASES = ["service", "inbox", "ams", "intake"];
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com", "me.com", "live.com", "msn.com", "comcast.net", "att.net", "verizon.net", "protonmail.com"]);

type UserLite = { id: number; username: string; full_name: string; email: string; inbox_alias: string; role: string };

/** `forwardedBy` is staff whose address the provider verified; `unverifiedStaff` only claims to be (SEC-008). */
export type Routing = { user: UserLite | null; forwardedBy: UserLite | null; unverifiedStaff: UserLite | null; via: string };

/** Decide whose queue the email lands in. */
export async function route(e: ParsedEmail, on: Queryable = db): Promise<Routing> {
  const users = await q<UserLite>("SELECT id, username, full_name, email, inbox_alias, role FROM users WHERE active", [], on);
  const domain = (process.env.INBOUND_EMAIL_DOMAIN || "").toLowerCase();
  const staff = users.find((u) => u.email.toLowerCase() === e.from.addr) ?? null;
  const forwardedBy = e.senderVerified ? staff : null;
  const unverifiedStaff = e.senderVerified ? null : staff;
  for (const a of [...(e.envelopeTo ?? []), ...e.to, ...e.cc]) {
    const [local, host] = a.addr.split("@");
    if (domain && host !== domain) continue;
    const alias = local.includes("+") ? local.split("+")[1] : local;
    const u = users.find((x) => x.inbox_alias.toLowerCase() === alias);
    if (u) return { user: u, forwardedBy, unverifiedStaff, via: `alias ${alias}@` };
  }
  if (forwardedBy) return { user: forwardedBy, forwardedBy, unverifiedStaff: null, via: "forwarded by staff" };
  return { user: null, forwardedBy: null, unverifiedStaff, via: unverifiedStaff ? "shared inbox (staff address not verified)" : "shared inbox" };
}

export type Match = { clientId: number | null; policyId: number | null; method: string | null; confidence: number };

/** Find the client (and policy) an email concerns. Strongest evidence wins. */
export async function matchClient(sender: Address, subject: string, body: string, on: Queryable = db): Promise<Match> {
  const text = `${subject}\n${body}`;
  const tokens = policyNumberCandidates(text);
  if (tokens.length) {
    const p = await one<{ id: number; client_id: number }>(
      `SELECT id, client_id FROM policies WHERE upper(policy_number) = ANY($1) OR upper(replace(policy_number,'-','')) = ANY($2)
       ORDER BY expiration_date DESC LIMIT 1`, [tokens, tokens.map((t) => t.replace(/-/g, ""))], on);
    if (p) return { clientId: p.client_id, policyId: p.id, method: "policy number in email", confidence: 0.95 };
  }
  // An address on several clients (an owner's personal and business accounts, a shared bookkeeper) says nothing about which one (CR-048).
  const byEmail = await q<{ id: number }>(
    `SELECT DISTINCT c.id FROM clients c LEFT JOIN contacts ct ON ct.client_id = c.id
      WHERE c.status <> 'inactive' AND (lower(ct.email) = $1 OR lower(c.email) = $1) LIMIT 2`, [sender.addr], on);
  if (byEmail.length === 1) return { clientId: byEmail[0].id, policyId: null, method: "sender is a client contact", confidence: 0.9 };
  const several = byEmail.length > 1;
  const dom = sender.addr.split("@")[1];
  if (dom && !several && !FREE_MAIL.has(dom)) {
    // The exact host, not a substring: ab.com must not match www.crab.com. Two clients on one domain is no answer at all (CR-008).
    const byDomain = await q<{ id: number }>(
      `SELECT id FROM clients
        WHERE status <> 'inactive' AND (split_part(regexp_replace(lower(coalesce(website, '')), '^(https?://)?(www\\.)?', ''), '/', 1) = $1
           OR split_part(lower(coalesce(email, '')), '@', 2) = $1) LIMIT 2`, [dom], on);
    if (byDomain.length === 1) return { clientId: byDomain[0].id, policyId: null, method: `sender domain ${dom}`, confidence: 0.75 };
  }
  // Business names mentioned in the subject or the first part of the body.
  const head = `${subject}\n${body.slice(0, 2000)}`.toLowerCase();
  const names = await q<{ id: number; name: string; dba: string | null }>(
    "SELECT id, name, dba FROM clients WHERE kind = 'business' AND status <> 'inactive'", [], on);
  const hit = names
    .map((n) => ({ id: n.id, len: [n.name, n.dba].filter(Boolean).map((s) => normName(s!)).filter((s) => s.length >= 8 && head.includes(s)).reduce((m, s) => Math.max(m, s.length), 0) }))
    .filter((x) => x.len > 0).sort((a, b) => b.len - a.len)[0];
  if (hit && (!several || byEmail.some((b) => b.id === hit.id))) return { clientId: hit.id, policyId: null, method: "client name in email", confidence: 0.6 };
  return { clientId: null, policyId: null, method: null, confidence: 0 };
}

const normName = (s: string) => s.toLowerCase().replace(/[,.]/g, "").replace(/\b(inc|llc|co|corp|corporation|company|ltd|pllc|pc)\b/g, "").replace(/\s+/g, " ").trim();

const RANK = { urgent: 3, high: 2, normal: 1, low: 0 } as const;

export type IngestResult = { emailId: number; activityId: number | null; duplicate: boolean; classifiedBy: "ai" | "rules"; classification: Classification; routedTo: string | null; match: Match };

/**
 * File one inbound email and create its action item. Idempotent on Message-ID: a provider retrying
 * a webhook gets the original result back.
 */
export async function ingestEmail(e: ParsedEmail, opts: { source?: string; actor?: string } = {}): Promise<IngestResult> {
  const messageId = e.messageId || `<generated-${createHash("sha256").update(`${e.from.addr}|${e.subject}|${e.text}`).digest("hex").slice(0, 24)}@siryous-ams>`;
  const existing = await one<{ id: number; activity_id: number | null; classification: Classification; classified_by: string }>(
    "SELECT id, activity_id, classification, classified_by FROM emails WHERE message_id = $1", [messageId]);
  if (existing) {
    return { emailId: existing.id, activityId: existing.activity_id, duplicate: true, classifiedBy: existing.classified_by === "ai" ? "ai" : "rules",
      classification: existing.classification, routedTo: null, match: { clientId: null, policyId: null, method: null, confidence: 0 } };
  }

  const today = todayISO();
  const routing = await route(e);
  const trustedStaff = !!routing.forwardedBy;
  const fwd = detectForward(e.subject, e.text, trustedStaff);
  const sender = fwd?.from ?? e.from;
  const subject = stripSubjectPrefixes(fwd?.subject ?? e.subject);
  const body = fwd ? fwd.body : newContent(e.text) || e.text;
  const staffNote = fwd && trustedStaff ? newContent(fwd.note).trim() : "";
  const match = await matchClient(sender, subject, body);

  const client = match.clientId ? await one<{ name: string; account_manager_id: number | null }>(
    "SELECT name, account_manager_id FROM clients WHERE id = $1", [match.clientId]) : null;
  const policies = match.clientId ? await q<{ id: number; number: string; lob: string; carrier: string; expires: string; status: string }>(
    `SELECT p.id, p.policy_number AS number, p.lob, ca.name AS carrier, p.expiration_date AS expires, p.status
       FROM policies p JOIN carriers ca ON ca.id = p.carrier_id WHERE p.client_id = $1 AND p.status IN ('active','pending_cancel','bound')
      ORDER BY p.expiration_date`, [match.clientId]) : [];
  const codes = await q<{ code: string; label: string; category: string; default_priority: keyof typeof RANK; default_due_days: number }>(
    "SELECT code, label, category, default_priority, default_due_days FROM activity_codes WHERE active");

  let classifiedBy: "ai" | "rules" = "rules";
  let c: Classification | null = null;
  if (aiEnabled()) {
    c = await classifyEmailAI({
      from: `${sender.name ?? ""} <${sender.addr}>`.trim(), subject, body: `${staffNote ? `Staff note: ${staffNote}\n\n` : ""}${body}`,
      forwardedBy: routing.forwardedBy?.full_name ?? null, today, codes,
      client: client ? { name: client.name, policies } : null,
    });
    if (c && codes.some((x) => x.code === c!.activity_code)) classifiedBy = "ai"; else c = null;
  }
  if (!c) c = classifyByRules(subject, `${staffNote}\n${body}`, today, client?.name);

  // A policy number the classifier named, if it belongs to the matched client.
  let policyId = match.policyId;
  if (!policyId && c.policy_number) policyId = policies.find((p) => p.number.toUpperCase() === c!.policy_number!.toUpperCase())?.id ?? null;
  if (!policyId && policies.length === 1) policyId = policies[0].id;

  const code = codes.find((x) => x.code === c!.activity_code) ?? codes.find((x) => x.code === "EMAIL-IN")!;
  // Text in an outside email can talk the model into anything, so its word alone never makes a task urgent (SEC-009).
  const rules = classifiedBy === "ai" ? classifyByRules(subject, `${staffNote}\n${body}`, today, client?.name) : null;
  const chosen = c.priority === "urgent" && rules && rules.priority !== "urgent" ? "high" : c.priority;
  const priority = RANK[chosen] >= RANK[code.default_priority] ? chosen : code.default_priority;
  const taskSubject = classifiedBy === "ai" ? `${code.label}: ${c.subject}`.slice(0, 200) : c.subject;
  const threshold = await getSetting("email_auto_action_confidence", DEFAULTS.email_auto_action_confidence);
  // A From address is only a claim until the provider's checks back it, whoever it names (SEC-026).
  const senderIsTheEvidence = match.method === "sender is a client contact" || !!match.method?.startsWith("sender domain");
  const unverified = routing.unverifiedStaff ? `Sender not verified: this claims to be from ${routing.unverifiedStaff.full_name}, but the mail provider's checks don't confirm it.`
    : fwd && !trustedStaff ? "Forwarded by someone outside the agency: the client match comes from text in the message. Confirm it."
    : !e.senderVerified && senderIsTheEvidence ? `Sender not verified: the mail provider's checks don't confirm this came from ${sender.addr}. Confirm with the client before changing coverage, cancelling or sending money.` : "";
  // Text in a message can name any client, so an outsider's attachments wait for a person to confirm the client (SEC-008).
  const fromBody = match.method === "policy number in email" || match.method === "client name in email";
  const senderOnFile = fromBody && match.clientId ? !!(await one(
    "SELECT 1 FROM contacts WHERE client_id = $1 AND lower(email) = $2 UNION ALL SELECT 1 FROM clients WHERE id = $1 AND lower(email) = $2 LIMIT 1", [match.clientId, sender.addr])) : false;
  const holdAttachments = e.attachments.length > 0 && !trustedStaff && (!!unverified || !e.senderVerified || (fromBody && !senderOnFile));
  const ownerId = routing.user?.id ?? client?.account_manager_id ?? (await one<{ id: number }>(
    "SELECT id FROM users WHERE active AND role IN ('principal','admin') ORDER BY role = 'principal' DESC, id LIMIT 1"))?.id ?? null;

  return tx(async (t) => {
    const row = await one<{ id: number }>(
      `INSERT INTO emails (message_id, from_addr, from_name, original_from_addr, original_from_name, to_addrs, cc_addrs, subject, body_text, body_html,
         received_at, routed_user_id, forwarded_by_user_id, client_id, policy_id, match_method, match_confidence, status, classification, classified_by, source, sender_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (message_id) DO NOTHING RETURNING id`,
      [messageId, e.from.addr, e.from.name, fwd ? sender.addr : null, fwd ? sender.name : null, e.to.map((a) => a.addr), e.cc.map((a) => a.addr),
        e.subject, e.text, e.html, e.date, ownerId, routing.forwardedBy?.id ?? null, match.clientId, policyId, match.method,
        match.confidence, c!.auto_reply ? "ignored" : "new", JSON.stringify(c), classifiedBy, opts.source ?? "webhook", !!e.senderVerified], t);
    // A provider's retry overlapping the first attempt: the first one won (CR-018).
    if (!row) {
      const first = await one<{ id: number; activity_id: number | null }>("SELECT id, activity_id FROM emails WHERE message_id = $1", [messageId], t);
      return { emailId: first!.id, activityId: first!.activity_id, duplicate: true, classifiedBy, classification: c!, routedTo: null, match: { clientId: null, policyId: null, method: null, confidence: 0 } };
    }
    const emailId = row.id;

    for (const a of e.attachments) {
      const f = await one<{ id: number }>("INSERT INTO files (sha256, mime, size, data) VALUES ($1,$2,$3,$4) RETURNING id",
        [createHash("sha256").update(a.data).digest("hex"), storedMime(a.mime, a.data), a.data.length, a.data], t);
      await t.query(`INSERT INTO documents (client_id, policy_id, email_id, folder, title, filename, mime, size, file_id)
                     VALUES ($1,$2,$3,'Email',$4,$5,$6,$7,$8)`, [holdAttachments ? null : match.clientId, holdAttachments ? null : policyId, emailId, a.filename, a.filename, storedMime(a.mime, a.data), a.data.length, f!.id]);
    }

    let activityId: number | null = null;
    if (!c!.auto_reply) {
      const description = [unverified, holdAttachments ? "Attachments are held on the email until you confirm the client." : "", classifiedBy === "ai" ? `AI summary of an external email: ${c!.summary}` : c!.summary, c!.requested_change ? `Requested change: ${c!.requested_change}` : "", staffNote ? `Note from ${routing.forwardedBy?.full_name ?? "staff"}: ${staffNote}` : "",
        `From ${sender.name ? `${sender.name} ` : ""}<${sender.addr}> · "${subject}"`].filter(Boolean).join("\n\n");
      const joined = code.code === "NONPAY" && policyId ? await noteOnOpenNonpay(policyId, `Another non-pay email: "${subject}" from ${sender.addr}`, t) : null;
      activityId = joined ?? await createActivity({
        code: code.code, subject: taskSubject, description, ownerId, clientId: match.clientId, policyId, emailId, priority,
        dueDate: dueDateFor(c!, code.default_due_days, today), source: "email", actor: opts.actor ?? "email-intake",
      }, t);
      // Confident on both who and what: done. Otherwise the task exists but the email waits in the
      // inbox for a person to confirm the client or the kind of work ("needs triage").
      const confident = match.confidence >= threshold && code.code !== "EMAIL-IN" && !unverified && !holdAttachments && (!!e.senderVerified || trustedStaff);
      await t.query("UPDATE emails SET activity_id = $2, status = $3 WHERE id = $1", [emailId, activityId, confident ? "actioned" : "new"]);
    }
    await audit({ actor: opts.actor ?? "email-intake", action: "email.received", entityType: "email", entityId: emailId,
      summary: `"${e.subject}" from ${e.from.addr} → ${routing.user?.full_name ?? "account manager"} (${classifiedBy}: ${code.code})`,
      after: { routed_via: routing.via, sender_verified: !!e.senderVerified, match: match.method, confidence: match.confidence, activity_id: activityId } }, t);
    const ownerName = routing.user?.full_name ?? (ownerId ? (await one<{ full_name: string }>("SELECT full_name FROM users WHERE id = $1", [ownerId], t))?.full_name ?? null : null);
    return { emailId, activityId, duplicate: false, classifiedBy, classification: c!, routedTo: ownerName, match: { ...match, policyId } };
  });
}

/**
 * Staff say which client an email belongs to. Its attachments follow, including any held back at intake (CR-028, SEC-008).
 * The form lists the old client's policies until the page reloads, so a policy from another client means none. Returns the policy kept.
 */
/** Does this email's task belong to more than this email? A later non-pay email joins the task already open on the policy (CR-047). */
export async function emailTask(emailId: number, on: Queryable = db) {
  const e = await one<{ activity_id: number | null; owner_id: number | null; own_email: number | null; emails: number }>(
    `SELECT e.activity_id, a.owner_id, a.email_id AS own_email, (SELECT count(*)::int FROM emails o WHERE o.activity_id = e.activity_id) AS emails
       FROM emails e LEFT JOIN activities a ON a.id = e.activity_id WHERE e.id = $1`, [emailId], on);
  return { activityId: e?.activity_id ?? null, ownerId: e?.owner_id ?? null, shared: !!e?.activity_id && (e.own_email !== emailId || e.emails > 1) };
}

/** Nothing to do on this email. Its task goes with it, unless other emails rely on that task. Says whether the task was shared. */
export async function ignoreEmail(id: number, user: Pick<User, "id">, c: Queryable): Promise<boolean> {
  const t = await emailTask(id, c);
  await c.query("UPDATE emails SET status = 'ignored' WHERE id = $1", [id]);
  if (t.shared) await systemNote(t.activityId!, "A related email was ignored; this task stays open.", c);
  else if (t.activityId) await c.query("UPDATE activities SET status = 'cancelled', outcome = 'Email needs no action', completed_at = now(), completed_by_id = $2 WHERE id = $1 AND status IN ('open','waiting')", [t.activityId, user.id]);
  return t.shared;
}

export class EmailNeedsClient extends Error { constructor() { super("Choose the client first. Unmatched email stays in triage."); } }

/** Staff confirm the match ("Looks right"), which is what releases attachments held at intake (CR-038). Says whether any were. There must be a match to confirm (UX-038). */
export async function confirmEmailReviewed(id: number, c: Queryable): Promise<boolean> {
  const e = await one<{ client_id: number | null; policy_id: number | null }>("SELECT client_id, policy_id FROM emails WHERE id = $1 FOR UPDATE", [id], c);
  if (e && !e.client_id) throw new EmailNeedsClient();
  const held = e?.client_id ? await one("SELECT 1 FROM documents WHERE email_id = $1 AND client_id IS NULL LIMIT 1", [id], c) : null;
  if (held) await relinkEmail(id, e!.client_id, e!.policy_id, c);
  else await c.query("UPDATE emails SET status = 'actioned' WHERE id = $1", [id]);
  return !!held;
}

/** Retyping settles the kind of work, not the client: an unmatched email stays in triage until someone picks one (UX-038). */
export async function retypeEmail(id: number, code: string, c: Queryable = db) {
  await c.query("UPDATE emails SET classification = jsonb_set(coalesce(classification,'{}'), '{activity_code}', to_jsonb($2::text)), status = CASE WHEN client_id IS NULL THEN status ELSE 'actioned' END WHERE id = $1", [id, code]);
}

export async function relinkEmail(id: number, clientId: number | null, postedPolicyId: number | null, c: Queryable): Promise<number | null> {
  const policyId = postedPolicyId && (await one("SELECT 1 FROM policies WHERE id = $1 AND client_id = $2", [postedPolicyId, clientId], c)) ? postedPolicyId : null;
  await c.query("UPDATE emails SET client_id = $2, policy_id = $3, status = 'actioned', match_method = 'confirmed by staff', match_confidence = 1 WHERE id = $1", [id, clientId, policyId]);
  await c.query("UPDATE documents SET client_id = $2, policy_id = $3 WHERE email_id = $1", [id, clientId, policyId]);
  return policyId;
}
