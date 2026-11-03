import Link from "next/link";
import { completeAction, resumeAction, snoozeAction, waitingAction } from "@/app/(app)/tasks/actions";
import { one } from "@/lib/db";
import { daysBetween, todayISO } from "@/lib/format";
import type { Scored } from "@/lib/priority";
import { currentUser, mayActOn } from "@/lib/user";
import type { TaskRow } from "@/lib/work";
import { Submit } from "./submit";
import { Flash, Reasons } from "./ui";

const DOT: Record<string, string> = { urgent: "bg-rose-500", high: "bg-amber-500", normal: "bg-slate-300", low: "bg-slate-200" };

export function DueLabel({ due, chase }: { due: string; chase?: boolean }) {
  const d = daysBetween(todayISO(), due);
  const txt = d === 0 ? "today" : d === 1 ? "tomorrow" : d === -1 ? "yesterday" : d < 0 ? `${-d}d ago` : `in ${d}d`;
  return <span className={`whitespace-nowrap text-xs tabular-nums ${d < 0 ? "font-medium text-rose-600" : d === 0 ? "font-medium text-amber-700" : "text-slate-500"}`}>{chase ? "chase " : "due "}{txt}</span>;
}

/**
 * The message bar on pages where a task can be completed. `undo` is the task just completed: the bar
 * names it, read from the database rather than the URL, and offers the way back (UX-006). The server
 * action checks permission again; this only decides whether to offer it.
 */
export async function TaskFlash({ msg, error, undo }: { msg?: string; error?: string; undo?: string }) {
  const id = !error && undo && /^\d+$/.test(undo) ? Number(undo) : null;
  const t = id ? await one<{ subject: string; status: string; owner_id: number | null }>("SELECT subject, status, owner_id FROM activities WHERE id = $1", [id]) : null;
  if (!t || t.status !== "done" || !mayActOn(await currentUser(), t.owner_id)) return <Flash msg={msg} error={error} />;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
      <span className="min-w-0">Completed “{t.subject}”.</span>
      <form action={resumeAction}><input type="hidden" name="id" value={id!} /><Submit className="font-medium underline" pending="Undoing…">Undo</Submit></form>
    </div>
  );
}

/** Quick actions: Done (optional outcome), Snooze, Waiting. Plain forms; no client JavaScript needed. */
export function QuickActions({ id, subject }: { id: number; subject: string }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <form action={completeAction}><input type="hidden" name="id" value={id} />
        <Submit pending="Saving…" className="rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60">✓ Done</Submit>
      </form>
      <details className="relative">
        <summary className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" aria-label={`Snooze or wait: ${subject}`}>⏱ Later</summary>
        <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 text-xs shadow-lg">
          <div className="mb-1 font-medium text-slate-500">Snooze until</div>
          <div className="mb-2 flex flex-wrap gap-1">
            {[["1", "Tomorrow"], ["3", "3 days"], ["7", "Next week"]].map(([d, l]) => (
              <form key={d} action={snoozeAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="days" value={d} /><button className="rounded border border-slate-200 px-2 py-1 hover:bg-slate-50">{l}</button></form>
            ))}
          </div>
          <div className="mb-1 font-medium text-slate-500">Waiting on</div>
          <div className="flex flex-wrap gap-1">
            {[["client", "Client"], ["carrier", "Carrier"], ["internal", "Colleague"]].map(([w, l]) => (
              <form key={w} action={waitingAction}><input type="hidden" name="id" value={id} /><input type="hidden" name="waiting_on" value={w} /><button className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-violet-700 hover:bg-violet-100">{l}</button></form>
            ))}
          </div>
        </div>
      </details>
    </div>
  );
}

export function TaskLine({ t, showOwner = false, showReasons = true, actions = true }: { t: Scored<TaskRow> | (TaskRow & { reasons?: never; chase?: boolean; score?: number }); showOwner?: boolean; showReasons?: boolean; actions?: boolean }) {
  const chase = t.status === "waiting";
  return (
    <li className="group flex flex-wrap items-start gap-3 px-4 py-2.5 hover:bg-slate-50/80 sm:flex-nowrap">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[t.priority]}`} role="img" aria-label={`${t.priority} priority`} title={`${t.priority} priority`} />
      <div className="min-w-0 flex-1 basis-[calc(100%-1.25rem)] sm:basis-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/tasks/${t.id}`} className="font-medium text-slate-900 hover:text-indigo-700">{t.subject}</Link>
          {t.source === "email" && <span title="Created from an email" className="text-[11px] text-sky-600">✉</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>{t.code_label}</span>
          {t.client_name && <><span>·</span><Link href={`/clients/${t.client_id}`} className="hover:text-slate-800 hover:underline">{t.client_name}</Link></>}
          {t.policy_number && <><span>·</span><Link href={`/policies/${t.policy_id}`} className="font-mono hover:underline">{t.policy_number}</Link></>}
          {showOwner && t.owner_name && <><span>·</span><span>{t.owner_name}</span></>}
          <span>·</span><DueLabel due={chase ? (t.follow_up_date ?? t.due_date) : t.due_date} chase={chase} />
        </div>
        {showReasons && "reasons" in t && t.reasons && <div className="mt-1.5"><Reasons reasons={t.reasons} /></div>}
      </div>
      {"score" in t && t.score != null && <span className="mt-0.5 hidden whitespace-nowrap text-right text-[11px] tabular-nums text-slate-500 sm:block">score <span title="Priority score: higher comes first">{t.score}</span></span>}
      {actions && <QuickActions id={t.id} subject={t.subject} />}
    </li>
  );
}
