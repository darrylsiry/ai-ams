import { audit } from "./audit";
import { db, one, q, tx, type Queryable } from "./db";
import { addDays, todayISO, whenDate } from "./format";
import { mayActOn } from "./permissions";
import { rank, RISK, type QueueTask, type Scored } from "./priority";
import type { User } from "./user";

// Activities: the universal work item (WRK-01..14). Every task screen, the email pipeline and the
// daily automation create and move work through these functions, so defaults, audit rows and
// notes are applied the same way everywhere.

export type ActivityCode = {
  code: string; label: string; category: string; default_priority: QueueTask["priority"];
  default_due_days: number; sla_hours: number | null; checklist: string[];
};

export async function activityCodes(): Promise<ActivityCode[]> {
  return q<ActivityCode>("SELECT * FROM activity_codes WHERE active ORDER BY category, label");
}

export type NewActivity = {
  code: string;
  subject: string;
  description?: string | null;
  ownerId: number | null;
  createdById?: number | null;
  clientId?: number | null;
  policyId?: number | null;
  claimId?: number | null;
  certificateId?: number | null;
  opportunityId?: number | null;
  emailId?: number | null;
  priority?: QueueTask["priority"];
  dueDate?: string;
  source?: "manual" | "email" | "system" | "automation" | "lead";
  autoKey?: string;            // automation: create once per key
  actor: string;
};

/** Create a task with its activity code's defaults. Returns the new id, or null when `autoKey` already exists. */
export async function createActivity(a: NewActivity, on: Queryable = db): Promise<number | null> {
  const code = await one<ActivityCode>("SELECT * FROM activity_codes WHERE code = $1", [a.code], on);
  if (!code) throw new Error(`Unknown activity code ${a.code}`);
  const due = a.dueDate ?? addDays(todayISO(), code.default_due_days);
  const checklist = JSON.stringify((code.checklist ?? []).map((label) => ({ label, done: false })));
  const row = await one<{ id: number }>(
    `INSERT INTO activities (code, subject, description, priority, owner_id, created_by_id, client_id, policy_id, claim_id,
       certificate_id, opportunity_id, email_id, due_date, source, checklist, auto_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (auto_key) DO NOTHING RETURNING id`,
    [a.code, a.subject, a.description ?? null, a.priority ?? code.default_priority, a.ownerId, a.createdById ?? null,
      a.clientId ?? null, a.policyId ?? null, a.claimId ?? null, a.certificateId ?? null, a.opportunityId ?? null,
      a.emailId ?? null, due, a.source ?? "manual", checklist, a.autoKey ?? null], on);
  if (!row) return null;
  await audit({ actor: a.actor, action: "activity.created", entityType: "activity", entityId: row.id,
    summary: `${code.label}: ${a.subject}`, after: { owner_id: a.ownerId, due, source: a.source ?? "manual" } }, on);
  return row.id;
}

export type TaskRow = QueueTask & {
  description: string | null; owner_id: number | null; owner_name: string | null; client_id: number | null;
  client_name: string | null; client_code: string | null; policy_id: number | null; policy_number: string | null;
  code_label: string; email_id: number | null; claim_id: number | null; certificate_id: number | null;
};

const PER_ROW_PREMIUM = `(SELECT coalesce(sum(p2.premium),0)::float FROM policies p2
            WHERE p2.client_id = a.client_id AND p2.status IN ('active','pending_cancel','bound')) AS client_premium`;

const TASK_SELECT = `
  SELECT a.id, a.code, ac.label AS code_label, ac.category, ac.sla_hours, a.subject, a.description, a.status, a.priority,
         a.due_date, a.follow_up_date, a.waiting_on, a.snoozed_until, a.source, a.created_at, a.owner_id,
         u.full_name AS owner_name, a.client_id, c.name AS client_name, c.code AS client_code, a.policy_id,
         p.policy_number, p.expiration_date AS policy_expiration, a.email_id, a.claim_id, a.certificate_id,
         ${PER_ROW_PREMIUM}
    FROM activities a
    JOIN activity_codes ac ON ac.code = a.code
    LEFT JOIN users u ON u.id = a.owner_id
    LEFT JOIN clients c ON c.id = a.client_id
    LEFT JOIN policies p ON p.id = a.policy_id`;

/** Client premium worked out once, for lists of many tasks (CR-035, CR-043). */
const QUEUE_SELECT = TASK_SELECT.replace(PER_ROW_PREMIUM, "coalesce(cp.premium, 0)::float AS client_premium").replace("FROM activities a", `FROM activities a
      LEFT JOIN (SELECT client_id, sum(premium) AS premium FROM policies WHERE status IN ('active','pending_cancel','bound') GROUP BY client_id) cp ON cp.client_id = a.client_id`);

/** One user's ranked queue for today (open tasks, plus waiting tasks whose follow-up date has come). */
export async function queueFor(userId: number, today = todayISO()): Promise<Scored<TaskRow>[]> {
  const rows = await q<TaskRow>(`${QUEUE_SELECT} WHERE a.owner_id = $1 AND a.status IN ('open','waiting')`, [userId]);
  return rank(rows, today);
}

/** Everyone's queue ranked together: the most at-risk work across the agency (manager view). */
export async function teamQueue(today = todayISO(), limit = 40): Promise<Scored<TaskRow>[]> {
  // Includes people who have been deactivated, flagged, and tasks with no owner, so that work can't quietly vanish (CR-014, CR-030).
  // Only what can be in a queue today, most pressing first, with client premium worked out once: this runs on every principal's My Day (CR-035).
  const [rows, gone] = await Promise.all([
    q<TaskRow>(`${QUEUE_SELECT}
      WHERE (a.status = 'open' AND (a.snoozed_until IS NULL OR a.snoozed_until <= $1)) OR (a.status = 'waiting' AND coalesce(a.follow_up_date, a.due_date) <= $1)
      ORDER BY (a.priority IN ('urgent','high') OR a.code = ANY($2)) DESC, a.due_date, a.id LIMIT 1000`, [today, Object.keys(RISK)]),
    q<{ id: number }>("SELECT id FROM users WHERE NOT active"),
  ]);
  const inactive = new Set(gone.map((g) => g.id));
  return rank(rows.map((r) => (!r.owner_id ? { ...r, owner_name: "Unassigned" } : inactive.has(r.owner_id) ? { ...r, owner_name: `${r.owner_name} (inactive)` } : r)), today).slice(0, limit);
}

/** Waiting tasks not yet due for a chase. */
export async function waitingFor(userId: number, today = todayISO()): Promise<TaskRow[]> {
  return q<TaskRow>(`${TASK_SELECT} WHERE a.owner_id = $1 AND a.status = 'waiting' AND (a.follow_up_date IS NULL OR a.follow_up_date > $2)
                     ORDER BY a.follow_up_date NULLS LAST`, [userId, today]);
}

export async function snoozedFor(userId: number, today = todayISO()): Promise<TaskRow[]> {
  return q<TaskRow>(`${TASK_SELECT} WHERE a.owner_id = $1 AND a.status = 'open' AND a.snoozed_until > $2 ORDER BY a.snoozed_until`, [userId, today]);
}

export async function taskById(id: number): Promise<TaskRow | null> {
  return one<TaskRow>(`${TASK_SELECT} WHERE a.id = $1`, [id]);
}

/** Tasks matching a filter, for the task list and the team view. */
export async function listTasks(f: { ownerId?: number | null; status?: string; category?: string; clientId?: number; policyId?: number; opportunityId?: number; limit?: number }): Promise<TaskRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (f.ownerId) add("a.owner_id = ?", f.ownerId);
  if (f.ownerId === null) where.push("a.owner_id IS NULL");
  if (f.status === "active") where.push("a.status IN ('open','waiting')");
  else if (f.status) add("a.status = ?", f.status);
  if (f.category) add("ac.category = ?", f.category);
  if (f.clientId) add("a.client_id = ?", f.clientId);
  if (f.policyId) add("a.policy_id = ?", f.policyId);
  if (f.opportunityId) add("a.opportunity_id = ?", f.opportunityId);
  params.push(f.limit ?? 300);
  return q<TaskRow>(`${TASK_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY CASE WHEN a.status IN ('open','waiting') THEN 0 ELSE 1 END, a.due_date, a.id DESC LIMIT $${params.length}`, params);
}

async function note(activityId: number, clientId: number | null, authorId: number | null, body: string, kind = "system", on: Queryable = db) {
  await on.query("INSERT INTO activity_notes (activity_id, client_id, author_id, kind, body) VALUES ($1,$2,$3,$4,$5)",
    [activityId, clientId, authorId, kind, body]);
}

async function load(id: number, on: Queryable) {
  const t = await one<{ id: number; subject: string; client_id: number | null; policy_id: number | null; owner_id: number | null; status: string; code: string }>(
    "SELECT id, subject, client_id, policy_id, owner_id, status, code FROM activities WHERE id = $1 FOR UPDATE", [id], on);
  if (!t) throw new Error("That task no longer exists.");
  return t;
}

/** Complete a task with an outcome; optionally create a follow-up task due in `followUpDays`. Returns the follow-up's id. */
export async function completeTask(id: number, user: User, outcome: string, followUpDays?: number | null): Promise<number | null> {
  return tx(async (c) => {
    const t = await load(id, c);
    await c.query("UPDATE activities SET status = 'done', outcome = $2, completed_at = now(), completed_by_id = $3, updated_at = now() WHERE id = $1",
      [id, outcome || null, user.id]);
    if (outcome) await note(id, t.client_id, user.id, `Completed: ${outcome}`, "note", c);
    await audit({ actor: user.username, action: "activity.completed", entityType: "activity", entityId: id, summary: `Completed "${t.subject}"`, after: { outcome } }, c);
    if (followUpDays && followUpDays > 0) {
      return createActivity({ code: "FOLLOW-UP", subject: `Follow up: ${t.subject}`, description: outcome || null, ownerId: t.owner_id ?? user.id,
        createdById: user.id, clientId: t.client_id, policyId: t.policy_id, dueDate: addDays(todayISO(), followUpDays), actor: user.username }, c);
    }
    return null;
  });
}

export async function snoozeTask(id: number, user: User, until: string) {
  await tx(async (c) => {
    const t = await load(id, c);
    await c.query("UPDATE activities SET snoozed_until = $2, status = 'open', updated_at = now() WHERE id = $1", [id, until]);
    await note(id, t.client_id, user.id, `Snoozed until ${whenDate(until)}`, "system", c);
    await audit({ actor: user.username, action: "activity.snoozed", entityType: "activity", entityId: id, summary: `Snoozed "${t.subject}" to ${until}` }, c);
  });
}

export async function setWaiting(id: number, user: User, waitingOn: string, followUp: string, comment?: string) {
  await tx(async (c) => {
    const t = await load(id, c);
    await c.query("UPDATE activities SET status = 'waiting', waiting_on = $2, follow_up_date = $3, snoozed_until = NULL, updated_at = now() WHERE id = $1",
      [id, waitingOn, followUp]);
    await note(id, t.client_id, user.id, `Waiting on ${waitingOn} — follow up ${whenDate(followUp)}${comment ? `. ${comment}` : ""}`, "system", c);
    await audit({ actor: user.username, action: "activity.waiting", entityType: "activity", entityId: id, summary: `Waiting on ${waitingOn} until ${followUp}` }, c);
  });
}

/** Back to work. A finished task (Undo, Reopen: UX-006) returns as it was: closing leaves the waiting and snooze fields alone, so it keeps its rank. Returns true for those. */
export async function resumeWith(id: number, user: Pick<User, "id" | "username">, c: Queryable): Promise<boolean> {
  const t = await load(id, c);
  if (t.status === "done" || t.status === "cancelled") {
    await c.query(`UPDATE activities SET status = CASE WHEN waiting_on IS NOT NULL AND follow_up_date IS NOT NULL AND snoozed_until IS NULL THEN 'waiting' ELSE 'open' END,
                     outcome = NULL, completed_at = NULL, completed_by_id = NULL, updated_at = now() WHERE id = $1`, [id]);
    await note(id, t.client_id, user.id, "Reopened", "system", c);
    await audit({ actor: user.username, action: "activity.reopened", entityType: "activity", entityId: id, summary: `Reopened "${t.subject}"`, before: { status: t.status } }, c);
    return true;
  }
  await c.query("UPDATE activities SET status = 'open', waiting_on = NULL, follow_up_date = NULL, snoozed_until = NULL, updated_at = now() WHERE id = $1", [id]);
  await note(id, t.client_id, user.id, "Back in my queue", "system", c);
  await audit({ actor: user.username, action: "activity.resumed", entityType: "activity", entityId: id, summary: `Resumed "${t.subject}"` }, c);
  return false;
}

export async function resumeTask(id: number, user: User): Promise<boolean> {
  return tx((c) => resumeWith(id, user, c));
}

/**
 * One notice, one task (UX-003): when a non-pay task is already open on the policy, however it was
 * created, the daily check notes it once a day and raises it to Urgent. Returns its id, or null when none is open.
 */
/** Close a task an action elsewhere was started from, only if this person may act on it (SEC-034). Says whether it closed. */
export async function completeLinkedTask(taskId: number, user: User, outcome: string): Promise<boolean> {
  const t = await one<{ status: string; owner_id: number | null }>("SELECT status, owner_id FROM activities WHERE id = $1", [taskId]);
  if (!t || (t.status !== "open" && t.status !== "waiting") || !mayActOn(user, t.owner_id)) return false;
  await completeTask(taskId, user, outcome);
  return true;
}

export async function systemNote(activityId: number, body: string, on: Queryable = db) {
  const t = await one<{ client_id: number | null }>("SELECT client_id FROM activities WHERE id = $1", [activityId], on);
  if (t) await note(activityId, t.client_id, null, body, "system", on);
}

/** A second non-pay email on a policy joins the task already open for it rather than starting another (UX-003). */
export async function noteOnOpenNonpay(policyId: number, body: string, on: Queryable = db): Promise<number | null> {
  const t = await one<{ id: number; client_id: number | null }>("SELECT id, client_id FROM activities WHERE policy_id = $1 AND code = 'NONPAY' AND status IN ('open','waiting') ORDER BY id LIMIT 1", [policyId], on);
  if (!t) return null;
  await note(t.id, t.client_id, null, body, "system", on);
  return t.id;
}

export async function remindOpenNonpay(policyId: number, cancelDate: string, today: string, actor: string, on: Queryable = db): Promise<number | null> {
  const t = await one<{ id: number; client_id: number | null; subject: string; priority: string }>(
    "SELECT id, client_id, subject, priority FROM activities WHERE policy_id = $1 AND code = 'NONPAY' AND status IN ('open','waiting') ORDER BY id LIMIT 1", [policyId], on);
  if (!t) return null;
  const body = `Daily check: still pending, cancels ${whenDate(cancelDate)}`;
  if (!await one("SELECT 1 AS seen FROM activity_notes WHERE activity_id = $1 AND body = $2 AND created_at::date = $3::date", [t.id, body, today], on)) await note(t.id, t.client_id, null, body, "system", on);
  if (t.priority !== "urgent") {
    await on.query("UPDATE activities SET priority = 'urgent', updated_at = now() WHERE id = $1", [t.id]);
    await audit({ actor, action: "activity.updated", entityType: "activity", entityId: t.id, summary: `Raised "${t.subject}" to urgent: cancellation still pending`, before: { priority: t.priority }, after: { priority: "urgent" } }, on);
  }
  return t.id;
}

export async function reassignTask(id: number, user: User, ownerId: number) {
  await tx(async (c) => {
    const t = await load(id, c);
    const to = await one<{ full_name: string }>("SELECT full_name FROM users WHERE id = $1", [ownerId], c);
    await c.query("UPDATE activities SET owner_id = $2, updated_at = now() WHERE id = $1", [id, ownerId]);
    await note(id, t.client_id, user.id, `Reassigned to ${to?.full_name ?? "someone"}`, "system", c);
    await audit({ actor: user.username, action: "activity.reassigned", entityType: "activity", entityId: id,
      summary: `Reassigned "${t.subject}" to ${to?.full_name}`, before: { owner_id: t.owner_id }, after: { owner_id: ownerId } }, c);
  });
}

export async function updateTask(id: number, user: User, f: { priority?: string; dueDate?: string; subject?: string; clientId?: number | null; policyId?: number | null }) {
  await tx(async (c) => {
    const t = await load(id, c);
    const sets: string[] = []; const params: unknown[] = [id];
    const set = (col: string, v: unknown) => { params.push(v); sets.push(`${col} = $${params.length}`); };
    if (f.priority) set("priority", f.priority);
    if (f.dueDate) set("due_date", f.dueDate);
    if (f.subject) set("subject", f.subject);
    if (f.clientId !== undefined) set("client_id", f.clientId);
    if (f.policyId !== undefined) set("policy_id", f.policyId);
    if (!sets.length) return;
    await c.query(`UPDATE activities SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
    await audit({ actor: user.username, action: "activity.updated", entityType: "activity", entityId: id, summary: `Updated "${t.subject}"`, after: f }, c);
  });
}

export async function cancelTask(id: number, user: User, reason: string) {
  await tx(async (c) => {
    const t = await load(id, c);
    await c.query("UPDATE activities SET status = 'cancelled', outcome = $2, completed_at = now(), completed_by_id = $3, updated_at = now() WHERE id = $1", [id, reason, user.id]);
    await audit({ actor: user.username, action: "activity.cancelled", entityType: "activity", entityId: id, summary: `Cancelled "${t.subject}": ${reason}` }, c);
  });
}

export async function addNote(activityId: number | null, clientId: number | null, user: User, body: string, kind: string, confidential: boolean) {
  await db.query("INSERT INTO activity_notes (activity_id, client_id, author_id, kind, body, confidential) VALUES ($1,$2,$3,$4,$5,$6)",
    [activityId, clientId, user.id, kind, body, confidential]);
  await audit({ actor: user.username, action: "note.added", entityType: activityId ? "activity" : "client", entityId: activityId ?? clientId ?? 0,
    summary: confidential ? "Confidential note added" : body.slice(0, 120) });
}

export async function toggleChecklist(id: number, index: number, user: User) {
  await db.query(
    `UPDATE activities SET checklist = jsonb_set(checklist, ARRAY[$2::text, 'done'], to_jsonb(NOT coalesce((checklist->$2::int->>'done')::boolean, false))),
       updated_at = now() WHERE id = $1`, [id, String(index)]);
  void user;
}

export type Note = { id: number; kind: string; body: string; confidential: boolean; created_at: Date; author: string | null; author_id: number | null };
export type NoteViewer = { id: number; pii: boolean };

/** A confidential note's text reaches its author and people with PII access, and nobody else (SEC-007). */
export const hideConfidential = <T extends { body: string; confidential: boolean; author_id: number | null }>(notes: T[], viewer: NoteViewer): T[] =>
  notes.map((n) => (n.confidential && !viewer.pii && n.author_id !== viewer.id ? { ...n, body: "Confidential note: your role can't read it." } : n));

export async function notesFor(activityId: number, viewer: NoteViewer): Promise<Note[]> {
  const notes = await q<Note>(`SELECT n.id, n.kind, n.body, n.confidential, n.created_at, u.full_name AS author, n.author_id
                    FROM activity_notes n LEFT JOIN users u ON u.id = n.author_id WHERE n.activity_id = $1 ORDER BY n.id DESC`, [activityId]);
  return hideConfidential(notes, viewer);
}
