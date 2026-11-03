"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { addDays, todayISO, whenDate } from "@/lib/format";
import { safeReturnPath } from "@/lib/http";
import { getSetting } from "@/lib/settings";
import { can, currentUser, Forbidden, mayActOn } from "@/lib/user";
import { addNote, cancelTask, completeTask, createActivity, reassignTask, resumeTask, setWaiting, snoozeTask, toggleChecklist, updateTask } from "@/lib/work";
import { one } from "@/lib/db";

// Every task transition the UI offers. Each one checks who may act, writes through lib/work.ts
// (which audits), then returns to where the user was, or to their next task.

const back = async (fallback = "/") => {
  const h = await headers();
  const to = new URL(safeReturnPath(h.get("referer"), h.get("host"), fallback), "http://x");
  to.searchParams.delete("undo"); // the page's last Undo offer doesn't outlive the next action
  return `${to.pathname}${to.search}`;
};
const withMsg = (path: string, key: "msg" | "error", text: string) => `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(text)}`;
const id = (f: FormData) => Number(f.get("id"));
/** What a person may write. System notes come only from the app (SEC-034). */
const NOTE_KINDS = ["note", "call", "email_out"];

/** Owners act on their own work; anyone with the team permission acts on anyone's; unassigned work is open to all. */
async function mayAct(taskId: number) {
  const u = await currentUser();
  const t = await one<{ owner_id: number | null }>("SELECT owner_id FROM activities WHERE id = $1", [taskId]);
  if (!t) throw new Error("That task no longer exists.");
  if (!mayActOn(u, t.owner_id)) redirect(withMsg(await back(), "error", t.owner_id ? "That task belongs to someone else. Ask them, or a principal, to change it." : "Your role can't change tasks."));
  return u;
}

function done(path: string, msg: string, undo?: number): never {
  revalidatePath("/", "layout");
  redirect(`${withMsg(path, "msg", msg)}${undo ? `&undo=${undo}` : ""}`);
}

export async function completeAction(f: FormData) {
  const u = await mayAct(id(f));
  const follow = Number(f.get("follow_up_days") || 0) || null;
  const followId = await completeTask(id(f), u, String(f.get("outcome") ?? "").trim(), follow);
  if (f.get("next") === "1") { revalidatePath("/", "layout"); redirect("/tasks/next?msg=" + encodeURIComponent("Done. Here's your next task.")); }
  if (followId) done(await back(), `Done — follow-up set for ${whenDate(addDays(todayISO(), follow!))}`);
  done(await back(), "Task completed", id(f));
}

/** The form's second button. A button's own name and value don't reach a server action, so it has its own action. */
export async function completeAndNextAction(f: FormData) {
  f.set("next", "1");
  await completeAction(f);
}

export async function snoozeAction(f: FormData) {
  const u = await mayAct(id(f));
  const days = Number(f.get("days") || 1);
  const until = String(f.get("until") || "") || addDays(todayISO(), days);
  await snoozeTask(id(f), u, until);
  if (f.get("next") === "1") { revalidatePath("/", "layout"); redirect("/tasks/next?msg=" + encodeURIComponent(`Snoozed to ${whenDate(until)}.`)); }
  done(await back(), `Snoozed until ${whenDate(until)}`);
}

export async function waitingAction(f: FormData) {
  const u = await mayAct(id(f));
  const on = String(f.get("waiting_on") || "client");
  const days = await getSetting<Record<string, number>>("waiting_followup_days", { client: 3, carrier: 5, internal: 2, other: 3 });
  const followUp = String(f.get("follow_up_date") || "") || addDays(todayISO(), days[on] ?? days.other ?? 3);
  await setWaiting(id(f), u, on, followUp, String(f.get("comment") ?? "").trim() || undefined);
  if (f.get("next") === "1") { revalidatePath("/", "layout"); redirect("/tasks/next?msg=" + encodeURIComponent(`Waiting on ${on} until ${whenDate(followUp)}.`)); }
  done(await back(), `Waiting on ${on} — back in your queue ${whenDate(followUp)}`);
}

export async function waitingAndNextAction(f: FormData) {
  f.set("next", "1");
  await waitingAction(f);
}

export async function resumeAction(f: FormData) {
  const u = await mayAct(id(f));
  const reopened = await resumeTask(id(f), u);
  done(await back(), reopened ? "Task reopened" : "Back in your queue");
}

export async function reassignAction(f: FormData) {
  const u = await mayAct(id(f));
  await reassignTask(id(f), u, Number(f.get("owner_id")));
  done(await back(), "Reassigned");
}

export async function updateAction(f: FormData) {
  const u = await mayAct(id(f));
  await updateTask(id(f), u, {
    priority: String(f.get("priority") || "") || undefined, dueDate: String(f.get("due_date") || "") || undefined,
    subject: String(f.get("subject") || "").trim() || undefined,
    clientId: f.has("client_id") ? (Number(f.get("client_id")) || null) : undefined,
    policyId: f.has("policy_id") ? (Number(f.get("policy_id")) || null) : undefined,
  });
  done(await back(), "Task updated");
}

export async function cancelAction(f: FormData) {
  const u = await mayAct(id(f));
  await cancelTask(id(f), u, String(f.get("reason") || "Not needed"));
  done(await back(), "Task cancelled");
}

export async function noteAction(f: FormData) {
  const u = await currentUser();
  if (!can(u, "write") && !can(u, "accounting")) throw new Forbidden("Your role can't add notes.");
  const body = String(f.get("body") ?? "").trim();
  if (!body) redirect(withMsg(await back(), "error", "Write something first."));
  const activityId = Number(f.get("activity_id")) || null;
  const clientId = Number(f.get("client_id")) || null;
  await addNote(activityId, clientId, u, body, NOTE_KINDS.includes(String(f.get("kind"))) ? String(f.get("kind")) : "note", f.get("confidential") === "on");
  done(await back(), "Note added");
}

export async function checklistAction(f: FormData) {
  const u = await mayAct(id(f));
  await toggleChecklist(id(f), Number(f.get("index")), u);
  revalidatePath(`/tasks/${id(f)}`);
  redirect(await back());
}

export async function createTaskAction(f: FormData) {
  const u = await currentUser();
  if (!can(u, "write") && !can(u, "accounting")) throw new Forbidden("Your role can't create tasks.");
  const subject = String(f.get("subject") ?? "").trim();
  if (!subject) redirect(withMsg("/tasks/new", "error", "A task needs a subject."));
  const newId = await createActivity({
    code: String(f.get("code") || "FOLLOW-UP"), subject, description: String(f.get("description") ?? "").trim() || null,
    ownerId: Number(f.get("owner_id")) || u.id, createdById: u.id, clientId: Number(f.get("client_id")) || null, policyId: Number(f.get("policy_id")) || null,
    claimId: Number(f.get("claim_id")) || null, priority: (String(f.get("priority") || "") || undefined) as never,
    dueDate: String(f.get("due_date") || "") || undefined, source: "manual", actor: u.username,
  });
  revalidatePath("/", "layout");
  redirect(`/tasks/${newId}?msg=${encodeURIComponent("Task created")}`);
}

export async function bulkReassignAction(f: FormData) {
  const u = await currentUser();
  if (!can(u, "team")) throw new Forbidden("Only principals and admins can reassign in bulk.");
  const ids = f.getAll("ids").map(Number).filter(Boolean);
  const owner = Number(f.get("owner_id"));
  if (!ids.length || !owner) redirect(withMsg(await back("/tasks"), "error", "Pick tasks and a person."));
  for (const tid of ids) await reassignTask(tid, u, owner);
  done(await back("/tasks"), `Reassigned ${ids.length} task(s)`);
}
