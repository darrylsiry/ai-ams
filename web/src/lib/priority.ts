// The account manager's priority queue (WRK-06, WRK-07). Pure module so node:test can load it.
//
// Every open task gets a score from what an experienced account manager weighs when deciding what to
// do next, and the reasons behind the score are shown as chips, so the order is never a mystery:
//   1. Coverage at risk: a non-pay or carrier cancellation notice, a claim, a binder about to lapse.
//   2. Time: overdue, due today, and how close the policy is to expiring.
//   3. The task's own priority (set by its activity code or by the person who created it).
//   4. Client weight: bigger accounts are harder to replace.
//   5. Responsiveness: a client email that has sat untouched for a day.
// Waiting tasks leave the queue until their follow-up date, then come back as "chase" items.

import { daysBetween } from "./format";

export type QueueTask = {
  id: number;
  code: string;
  category: string;
  subject: string;
  status: "open" | "waiting" | "done" | "cancelled";
  priority: "urgent" | "high" | "normal" | "low";
  due_date: string;
  follow_up_date: string | null;
  waiting_on: string | null;
  snoozed_until: string | null;
  source: string;
  created_at: Date | string;
  client_premium: number | null;     // total in-force premium for the client
  policy_expiration: string | null;  // linked policy's expiration date
  sla_hours: number | null;
};

export type Reason = { label: string; tone: "red" | "amber" | "blue" | "slate" | "green" };
export type Scored<T> = T & { score: number; reasons: Reason[]; chase: boolean };

const PRIORITY_POINTS = { urgent: 100, high: 60, normal: 30, low: 10 } as const;
export const RISK: Record<string, [number, string]> = {
  NONPAY: [45, "Coverage at risk: non-pay"],
  "UW-CANC": [45, "Coverage at risk: carrier notice"],
  "BINDER-EXP": [40, "Binder lapsing"],
  "CLAIM-FNOL": [35, "New claim"],
  "CERT-REQ": [20, "Certificate needed for work"],
  "ID-CARD": [15, "Proof of insurance"],
  "CANC-REQ": [10, "Cancellation"],
};

/** Score one task as of `today` (YYYY-MM-DD). `now` decides how long an email has waited. */
export function scoreTask<T extends QueueTask>(t: T, today: string, now: Date = new Date()): Scored<T> {
  const reasons: Reason[] = [];
  const chase = t.status === "waiting";
  let score = PRIORITY_POINTS[t.priority] ?? 30;
  if (t.priority === "urgent") reasons.push({ label: "Urgent", tone: "red" });
  else if (t.priority === "high") reasons.push({ label: "High priority", tone: "amber" });

  const due = chase ? (t.follow_up_date ?? t.due_date) : t.due_date;
  const late = daysBetween(due, today);           // positive: days overdue
  if (late > 0) {
    score += 25 + Math.min(late, 10) * 8;
    reasons.push({ label: `${late}d ${chase ? "since follow-up date" : "overdue"}`, tone: "red" });
  } else if (late === 0) {
    score += 25;
    reasons.push({ label: chase ? "Follow up today" : "Due today", tone: "amber" });
  } else {
    score -= Math.min(-late, 14) * 3;
  }

  const risk = RISK[t.code];
  if (risk) { score += risk[0]; reasons.push({ label: risk[1], tone: risk[0] >= 35 ? "red" : "amber" }); }

  if (t.policy_expiration) {
    const left = daysBetween(today, t.policy_expiration);
    if (t.category === "Renewal" || t.code === "BINDER-EXP") {
      // A lapse within three days outranks late routine work (UX-007); coverage already gone never ranks below it.
      if (left < 0) { score += 80; reasons.push({ label: "Policy already expired", tone: "red" }); }
      else if (left <= 3) { score += 80; reasons.unshift({ label: `Coverage at risk: lapses ${left === 0 ? "today" : left === 1 ? "tomorrow" : `in ${left}d`}`, tone: "red" }); }
      else if (left <= 15) { score += 35; reasons.push({ label: `Expires in ${left}d`, tone: "red" }); }
      else if (left <= 30) { score += 20; reasons.push({ label: `Expires in ${left}d`, tone: "amber" }); }
      else if (left <= 60) { score += 8; reasons.push({ label: `Expires in ${left}d`, tone: "slate" }); }
    }
  }

  const premium = Number(t.client_premium ?? 0);
  if (premium >= 25_000) { score += 15; reasons.push({ label: "Key account", tone: "blue" }); }
  else if (premium >= 10_000) { score += 8; reasons.push({ label: "Mid-size account", tone: "slate" }); }

  if (t.source === "email" && !chase) {
    const hours = (now.getTime() - new Date(t.created_at).getTime()) / 3_600_000;
    if (hours >= 24) { score += 10; reasons.push({ label: "Client email waiting 1d+", tone: "amber" }); }
    else reasons.push({ label: "From email", tone: "blue" });
    if (t.sla_hours && hours > t.sla_hours) { score += 10; reasons.push({ label: `Past ${t.sla_hours}h service standard`, tone: "red" }); }
  }

  if (chase) { score -= 10; reasons.unshift({ label: `Chase ${t.waiting_on ?? "response"}`, tone: "slate" }); }
  return { ...t, score: Math.round(score), reasons, chase };
}

/** Days left in words: never "0d" (UX-007). */
export const daysLeft = (left: number) => (left === 0 ? "today" : left === 1 ? "tomorrow" : `${left}d`);

/** Is the task in today's working queue? Open and not snoozed past today, or waiting with its follow-up date reached. */
export function inQueue(t: QueueTask, today: string): boolean {
  if (t.status === "open") return !t.snoozed_until || t.snoozed_until <= today;
  if (t.status === "waiting") return !!t.follow_up_date && t.follow_up_date <= today;
  return false;
}

/** Highest score first; ties go to the older due date, then the lower id (stable). */
export function rank<T extends QueueTask>(tasks: T[], today: string, now = new Date()): Scored<T>[] {
  return tasks.filter((t) => inQueue(t, today)).map((t) => scoreTask(t, today, now))
    .sort((a, b) => b.score - a.score || a.due_date.localeCompare(b.due_date) || a.id - b.id);
}

/** Bucket for the "My day" view. */
export function bucket(t: Scored<QueueTask>, today: string): "now" | "today" | "later" {
  const due = t.chase ? (t.follow_up_date ?? t.due_date) : t.due_date;
  if (t.priority === "urgent" || due < today) return "now";
  if (due === today) return "today";
  return "later";
}
