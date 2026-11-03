import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import Link from "next/link";
import { bulkReassignAction } from "./actions";
import { DueLabel, TaskFlash } from "@/components/tasks";
import { Submit } from "@/components/submit";
import { Card, Empty, PageHeader, Pill, PriorityBadge, Status, Tabs, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { addDays, todayISO, whenDate } from "@/lib/format";
import { activeUsers, can, currentUser } from "@/lib/user";
import { qs as buildQs } from "@/lib/url";

export const metadata = { title: "Tasks" };

type Row = { id: number; subject: string; code_label: string; category: string; priority: string; status: string; due_date: string; follow_up_date: string | null; snoozed_until: string | null; source: string;
  client_id: number | null; client_name: string | null; policy_number: string | null; owner_name: string | null; completed_at: Date | null };

export default async function Tasks({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const team = can(user, "team");
  const view = sp.view ?? "mine";
  const status = sp.status ?? "active";
  const today = todayISO();
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
  if (view === "mine") add("a.owner_id = ?", user.id);
  else if (view === "user" && sp.user) add("a.owner_id = ?", Number(sp.user));
  else if (view === "unassigned") where.push("a.owner_id IS NULL");
  if (status === "active") where.push("a.status IN ('open','waiting')");
  else if (status === "snoozed") add("a.status = 'open' AND a.snoozed_until > ?", today);
  else if (status !== "all") add("a.status = ?", status);
  // Overdue and Due today count what's actually in the queue, like the My Day tiles that open them. Snoozed work has its own filter (UX-004, UX-005).
  const awake = status === "snoozed" ? "" : " AND (a.snoozed_until IS NULL OR a.snoozed_until <= ?)";
  if (sp.due === "overdue") add(`a.status = 'open' AND a.due_date < ?${awake}`, today);
  if (sp.due === "today") add(`a.status = 'open' AND a.due_date = ?${awake}`, today);
  if (sp.due === "week") add("a.due_date <= ?", addDays(today, 7));
  if (sp.category) add("ac.category = ?", sp.category);
  if (sp.source) add("a.source = ?", sp.source);
  if (sp.q) add("(a.subject ILIKE '%' || ? || '%' OR c.name ILIKE '%' || ? || '%')", sp.q);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM activities a JOIN activity_codes ac ON ac.code = a.code LEFT JOIN clients c ON c.id = a.client_id ${whereSql}`, params);
  const at = paging(sp.page, count!.n);
  const rows = await q<Row>(`
    SELECT a.id, a.subject, ac.label AS code_label, ac.category, a.priority, a.status, a.due_date, a.follow_up_date, a.snoozed_until, a.source, a.client_id, c.name AS client_name,
           p.policy_number, u.full_name AS owner_name, a.completed_at
      FROM activities a JOIN activity_codes ac ON ac.code = a.code LEFT JOIN clients c ON c.id = a.client_id
      LEFT JOIN policies p ON p.id = a.policy_id LEFT JOIN users u ON u.id = a.owner_id
     ${whereSql}
     ORDER BY CASE WHEN a.status IN ('open','waiting') THEN 0 ELSE 1 END,
              CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, a.due_date, a.id DESC
     LIMIT ${at.size} OFFSET ${at.offset}`, params);
  const [users, categories] = await Promise.all([activeUsers(), q<{ category: string }>("SELECT DISTINCT category FROM activity_codes ORDER BY 1")]);
  const qs = (o: Record<string, string | undefined>) => buildQs(sp, { page: undefined, undo: undefined, ...o });
  const tabs = [{ key: "mine", label: "My tasks", href: qs({ view: "mine", user: undefined }) }, ...(team ? [{ key: "team", label: "Everyone", href: qs({ view: "team", user: undefined }) }] : []),
    { key: "unassigned", label: "Unassigned", href: qs({ view: "unassigned", user: undefined }) }, ...(view === "user" ? [{ key: "user", label: users.find((u) => u.id === Number(sp.user))?.full_name ?? "Person", href: "#" }] : [])];

  return (
    <div>
      <TaskFlash msg={sp.msg} error={sp.error} undo={sp.undo} />
      <PageHeader title="Tasks" subtitle={`${at.total} task${at.total === 1 ? "" : "s"}`}
        actions={<><Link href="/tasks/next" className={cls.btn}>Next task →</Link><Link href="/tasks/new" className={cls.btnPrimary}>＋ New task</Link></>} />
      <Tabs tabs={tabs} current={view} />
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <input type="hidden" name="view" value={view} />{sp.user && <input type="hidden" name="user" value={sp.user} />}
        <input name="q" defaultValue={sp.q} placeholder="Subject or client" className={`${cls.inputInline} w-56`} />
        <select name="status" defaultValue={status} className={`${cls.inputInline} w-auto`}><option value="active">Open &amp; waiting</option><option value="open">Open</option><option value="waiting">Waiting</option><option value="snoozed">Snoozed</option><option value="done">Done</option><option value="cancelled">Cancelled</option><option value="all">All</option></select>
        <select name="due" defaultValue={sp.due ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Any due date</option><option value="overdue">Overdue</option><option value="today">Due today</option><option value="week">Due within 7 days</option></select>
        <select name="category" defaultValue={sp.category ?? ""} className={`${cls.inputInline} w-auto`}><option value="">All types</option>{categories.map((c) => <option key={c.category}>{c.category}</option>)}</select>
        <select name="source" defaultValue={sp.source ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Any source</option><option value="email">From email</option><option value="manual">Manual</option><option value="system">System</option><option value="automation">Automation</option><option value="lead">Lead</option></select>
        <button className={cls.btn}>Filter</button>
        {view === "team" && team && <span className="ml-auto text-xs text-slate-500">Tick tasks below to reassign in bulk</span>}
      </form>
      <Card>
        <form action={bulkReassignAction}>
          {rows.length === 0 ? <Empty>No tasks match.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px]">
                <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{[team ? "" : null, "Task", "Type", "Owner", "Due", "Priority", "Status"].filter((h) => h !== null).map((h, i) => <th key={i} className={cls.th}>{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70">
                      {team && <td className="w-8 px-3 py-2"><input type="checkbox" name="ids" value={r.id} aria-label={`Select ${r.subject}`} /></td>}
                      <td className={cls.td}><Link href={`/tasks/${r.id}`} className="font-medium text-slate-900 hover:text-indigo-700">{r.subject}</Link>{r.source === "email" && <span className="ml-1 text-sky-600" title="From email">✉</span>}
                        <div className="text-xs text-slate-500">{r.client_name ? <Link className="hover:underline" href={`/clients/${r.client_id}`}>{r.client_name}</Link> : "No client"}{r.policy_number && <span className="font-mono"> · {r.policy_number}</span>}</div></td>
                      <td className={`${cls.td} text-xs`}>{r.code_label}<div className="text-slate-500">{r.category}</div></td>
                      <td className={`${cls.td} text-xs`}>{r.owner_name ?? "—"}</td>
                      <td className={cls.td}>{r.status === "done" || r.status === "cancelled" ? <span className="text-xs text-slate-500">{r.completed_at ? whenDate(new Date(r.completed_at)) : ""}</span> : <DueLabel due={r.status === "waiting" ? (r.follow_up_date ?? r.due_date) : r.due_date} chase={r.status === "waiting"} />}</td>
                      <td className={cls.td}><PriorityBadge p={r.priority} /></td>
                      <td className={cls.td}><Status s={r.status} />{r.status === "open" && r.snoozed_until && r.snoozed_until > today && <span className="ml-1"><Pill tone="violet">snoozed to {whenDate(r.snoozed_until)}</Pill></span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {team && rows.length > 0 && (
            <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-sm">
              <span className="text-slate-500">Reassign selected to</span>
              <select name="owner_id" className={`${cls.inputInline} w-56`}>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
              <Submit className={cls.btn}>Reassign</Submit>
            </div>
          )}
        </form>
        <Pager at={at} href={(page) => qs({ page: String(page) })} label="Task pages" />
      </Card>
    </div>
  );
}
