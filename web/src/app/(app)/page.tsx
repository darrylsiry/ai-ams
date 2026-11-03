import { assistantConfigured } from "@/lib/assistant";
import { DEFAULTS, getSetting } from "@/lib/settings";
import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import Link from "next/link";
import { Submit } from "@/components/submit";
import { AskBox } from "@/components/ask-box";
import { TaskFlash, TaskLine } from "@/components/tasks";
import { Card, Empty, PageHeader, Pill, Stat, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { resumeAction } from "./tasks/actions";
import { daysBetween, money, todayISO, whenDate, whenShort } from "@/lib/format";
import { bucket, daysLeft } from "@/lib/priority";
import { lobLabel, RENEWAL_STAGE_LABEL } from "@/lib/ref";
import { can, currentUser } from "@/lib/user";
import { queueFor, snoozedFor, teamQueue, waitingFor } from "@/lib/work";

export const metadata = { title: "My day" };

const QUEUE_CARD = "lg:absolute lg:inset-0 lg:overflow-y-auto";
const ASK_SUGGESTIONS = ["What should I work on next?", "What's at risk this week?", "Which renewals need attention?"];

const RENEWALS = "/renewals?view=mine&days=60";

// My day: the account manager's working surface (WRK-06/07). One ranked queue answers "what should
// I do next?", with the reasons shown; the side column holds what feeds the queue: new email to
// triage, renewals coming up, work waiting on others, and (for principals) the team's load.

export default async function MyDay({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const today = todayISO();
  const [queue, waiting, snoozed, stats, emails, renewals, team] = await Promise.all([
    queueFor(user.id, today),
    waitingFor(user.id, today),
    snoozedFor(user.id, today),
    one<{ done_today: number; done_week: number; created_today: number }>(
      `SELECT count(*) FILTER (WHERE completed_at::date = $2::date AND status = 'done')::int AS done_today,
              count(*) FILTER (WHERE completed_at >= $2::date - 6 AND status = 'done')::int AS done_week,
              count(*) FILTER (WHERE created_at::date = $2::date)::int AS created_today
         FROM activities WHERE owner_id = $1`, [user.id, today]),
    q<{ id: number; subject: string; from_name: string | null; from_addr: string; original_from_name: string | null; received_at: Date; client_name: string | null; activity_id: number | null; match_confidence: string | null; total: number }>(
      `SELECT e.id, e.subject, e.from_name, e.from_addr, e.original_from_name, e.received_at, c.name AS client_name, e.activity_id, e.match_confidence, count(*) OVER ()::int AS total
         FROM emails e LEFT JOIN clients c ON c.id = e.client_id
        WHERE e.status = 'new' AND (e.routed_user_id = $1 OR ($2 AND e.routed_user_id IS NULL)) ORDER BY e.received_at DESC LIMIT 6`, [user.id, can(user, "team")]),
    q<{ id: number; policy_number: string; lob: string; expiration_date: string; renewal_stage: string; client_name: string; client_id: number; premium: string; total: number }>(
      `SELECT p.id, p.policy_number, p.lob, p.expiration_date, p.renewal_stage, c.name AS client_name, c.id AS client_id, p.premium, count(*) OVER ()::int AS total
         FROM policies p JOIN clients c ON c.id = p.client_id
        WHERE coalesce(p.renewal_owner_id, p.account_manager_id) = $1 AND p.status IN ('active','pending_cancel') AND p.renewal_policy_id IS NULL
          AND p.renewal_stage NOT IN ('renewed','lost','non_renewed') AND p.expiration_date BETWEEN $2::date AND $2::date + 60
        ORDER BY p.expiration_date LIMIT 8`, [user.id, today]),
    can(user, "team") ? q<{ id: number; full_name: string; role: string; open: number; overdue: number; due_today: number; done_today: number; urgent: number }>(
      `SELECT u.id, u.full_name, u.role,
              count(a.*) FILTER (WHERE a.status IN ('open','waiting'))::int AS open,
              count(a.*) FILTER (WHERE a.status = 'open' AND a.due_date < $1)::int AS overdue,
              count(a.*) FILTER (WHERE a.status = 'open' AND a.due_date = $1)::int AS due_today,
              count(a.*) FILTER (WHERE a.status = 'done' AND a.completed_at::date = $1::date)::int AS done_today,
              count(a.*) FILTER (WHERE a.status = 'open' AND a.priority = 'urgent')::int AS urgent
         FROM users u LEFT JOIN activities a ON a.owner_id = u.id
        WHERE u.active AND u.role IN ('account_manager','csr','producer')
        GROUP BY u.id ORDER BY overdue DESC, open DESC`, [today]) : Promise.resolve([]),
  ]);

  const assistantOn = assistantConfigured() && (await getSetting("ai_assists", DEFAULTS.ai_assists)).assistant !== false;
  const manager = can(user, "team");
  const teamView = manager && (sp.view === "team" || (sp.view !== "mine" && queue.length === 0));
  const teamTop = teamView ? await teamQueue(today) : [];
  const now = queue.filter((t) => bucket(t, today) === "now");
  const todayList = queue.filter((t) => bucket(t, today) === "today");
  const later = queue.filter((t) => bucket(t, today) === "later");
  const overdue = queue.filter((t) => !t.chase && t.due_date < today).length;
  const dueToday = queue.filter((t) => !t.chase && t.due_date === today).length;
  const chase = queue.filter((t) => t.chase).length;
  const hour = Number(new Date().toLocaleString("en-US", { timeZone: process.env.DISPLAY_TZ || "America/New_York", hour: "numeric", hour12: false }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const goal = Math.max(stats!.done_today + now.length + todayList.length, 1);
  const showLater = sp.show === "all";
  // The sidebar badge, this tile and the page it opens all mean the same 60 days (UX-004).
  const renewalTotal = renewals[0]?.total ?? 0;

  const group = (title: string, list: typeof queue, hint: string, tone: string) => {
    if (!list.length) return false;
    const param = `page_${title.toLowerCase().replace(/[^a-z]+/g, "_")}`;
    const at = paging(sp[param], list.length);
    return <div>
      <div className={`flex items-center gap-2 border-y border-slate-100 bg-slate-50/70 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>
        {title}<span className="rounded-full bg-white px-1.5 text-slate-500 ring-1 ring-slate-200">{list.length}</span><span className="font-normal normal-case tracking-normal text-slate-500">{hint}</span>
      </div>
      <ul className="divide-y divide-slate-100">{pageOf(list, at).map((t) => <TaskLine key={t.id} t={t} />)}</ul>
      <Pager at={at} href={(page) => qs(sp, { [param]: String(page), undo: undefined })} label={`${title} pages`} />
    </div>;
  };

  return (
    <div>
      <TaskFlash msg={sp.msg} error={sp.error} undo={sp.undo} />
      <PageHeader
        title={`${greeting}, ${user.full_name.split(" ")[0]}`}
        subtitle={<>{new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })} · {now.length + todayList.length ? `${now.length + todayList.length} task${now.length + todayList.length === 1 ? "" : "s"} need you today` : "Nothing due — a good day to get ahead on renewals"}</>}
        actions={<>
          <Link href="/tasks/new" className={cls.btn}>＋ Task</Link>
          <Link href="/tasks/next" className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500">Start next task <span aria-hidden>→</span></Link>
        </>}
      />

      <AskBox userId={user.id} suggestions={ASK_SUGGESTIONS} disabled={!assistantOn} />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Stat label="Overdue" value={overdue} tone={overdue ? "red" : "slate"} href="/tasks?view=mine&due=overdue" />
        <Stat label="Due today" value={dueToday} tone={dueToday ? "amber" : "slate"} href="/tasks?view=mine&due=today" />
        <Stat label="Emails to triage" value={emails[0]?.total ?? 0} tone={emails.length ? "indigo" : "slate"} href="/inbox" />
        <Stat label="Chase today" value={chase} sub={`${waiting.length} more waiting`} href="/tasks?view=mine&status=waiting" />
        <Stat label="Renewals ≤ 60 days" value={renewalTotal} href={RENEWALS} />
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-medium text-slate-500">Done today</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">{stats!.done_today}</div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (stats!.done_today / goal) * 100)}%` }} /></div>
          <div className="mt-1 text-[11px] text-slate-500">{stats!.done_week} this week</div>
        </div>
      </div>

      {manager && <div className="mb-5 flex gap-1 text-sm">
        <Link href="/?view=mine" className={!teamView ? cls.btnPrimary : cls.btn}>My queue ({queue.length})</Link>
        <Link href="/?view=team" className={teamView ? cls.btnPrimary : cls.btn}>Team priorities</Link>
      </div>}
      {/* The two columns start and end level. The side column sets the height, however long the queue is: the queue scrolls inside its card. */}
      <div className="grid min-w-0 gap-5 lg:grid-cols-3">
        <div className="relative min-w-0 lg:col-span-2 lg:min-h-[36rem]">
          {teamView ? (
            <Card className={QUEUE_CARD} title="Team priorities" action={<span className="text-slate-500">The most at-risk work across the agency · <Link className={cls.link} href="/tasks?view=team">all team tasks</Link></span>}>
              {teamTop.length === 0 ? <Empty>No open work.</Empty> : <ul className="divide-y divide-slate-100">{teamTop.map((t) => <TaskLine key={t.id} t={t} showOwner />)}</ul>}
            </Card>
          ) : (
          <Card className={QUEUE_CARD} title="Priority queue" action={<span className="text-slate-500">Ranked by coverage risk, due date, priority and account size · <Link className={cls.link} href="/tasks?view=mine">all my tasks</Link></span>}>
            {queue.length === 0 ? <Empty>Your queue is clear.</Empty> : (
              <>
                {group("Do now", now, "urgent or overdue", "text-rose-700")}
                {group("Today", todayList, "due today", "text-amber-700")}
                {showLater ? group("Coming up", later, "due later — get ahead", "text-slate-500") : later.length > 0 && (
                  <div className="border-t border-slate-100 px-4 py-2.5 text-sm"><Link href="/?show=all&view=mine" className={cls.link}>Show {later.length} upcoming task{later.length === 1 ? "" : "s"} →</Link></div>
                )}
              </>
            )}
          </Card>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 [&>*:last-child]:flex-1">
          <Card title="Email to triage" action={<Link href="/inbox" className={cls.link}>Inbox</Link>}>
            {emails.length === 0 ? <Empty>Nothing waiting. Forward client email to <span className="font-mono text-xs">{user.inbox_alias}@{process.env.INBOUND_EMAIL_DOMAIN || "amsinbox.siryous.app"}</span> and it becomes a task.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {emails.map((e) => (
                  <li key={e.id} className="px-4 py-2.5">
                    <Link href={`/inbox/${e.id}`} className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700">{e.subject}</Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <span className="truncate">{e.original_from_name ?? e.from_name ?? e.from_addr}</span><span>·</span><span className="whitespace-nowrap">{whenShort(e.received_at)}</span>
                      {e.client_name ? <Pill tone="amber">check client</Pill> : <Pill tone="red">no client match</Pill>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Renewals on my desk" action={<Link href={RENEWALS} className={cls.link}>Pipeline</Link>}>
            {renewals.length === 0 ? <Empty>No renewals in the next 60 days.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {renewals.map((r) => {
                  const left = daysBetween(today, r.expiration_date);
                  return (
                    <li key={r.id} className="flex items-center gap-3 px-4 py-2">
                      <span className={`w-14 shrink-0 text-right text-xs font-semibold tabular-nums ${left <= 15 ? "text-rose-600" : left <= 30 ? "text-amber-600" : "text-slate-500"}`}>{daysLeft(left)}</span>
                      <div className="min-w-0 flex-1">
                        <Link href={`/policies/${r.id}`} className="block truncate text-sm text-slate-900 hover:text-indigo-700">{r.client_name}</Link>
                        <div className="text-xs text-slate-500">{lobLabel(r.lob)} · {money(r.premium)}</div>
                      </div>
                      <Pill tone={r.renewal_stage === "not_started" ? "red" : r.renewal_stage === "presented" ? "violet" : "slate"}>{RENEWAL_STAGE_LABEL[r.renewal_stage]}</Pill>
                    </li>
                  );
                })}
              </ul>
            )}
            {renewalTotal > renewals.length && <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing {renewals.length} of {renewalTotal} · <Link href={RENEWALS} className={cls.link}>Pipeline →</Link></div>}
          </Card>

          <Card title="Waiting on others" action={<span className="text-slate-500">returns to your queue on its date</span>}>
            {waiting.length === 0 ? <Empty>Nothing parked.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {waiting.slice(0, 8).map((t) => (
                  <li key={t.id} className="px-4 py-2">
                    <Link href={`/tasks/${t.id}`} className="block truncate text-sm text-slate-900 hover:text-indigo-700">{t.subject}</Link>
                    <div className="text-xs text-slate-500">on {t.waiting_on} · back {t.follow_up_date ? whenDate(t.follow_up_date) : "no date set"}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={`Snoozed · ${snoozed.length}`} action={<span className="text-slate-500">returns to your queue on its date</span>}>
            {snoozed.length === 0 ? <Empty>Nothing snoozed.</Empty> : (
              <ul className="divide-y divide-slate-100">
                {snoozed.slice(0, 8).map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/tasks/${t.id}`} className="block truncate text-sm text-slate-900 hover:text-indigo-700">{t.subject}</Link>
                      <div className="text-xs text-slate-500">back {whenDate(t.snoozed_until!)}</div>
                    </div>
                    <form action={resumeAction}><input type="hidden" name="id" value={t.id} /><Submit className={cls.btnSm} pending="Saving…">Unsnooze</Submit></form>
                  </li>
                ))}
              </ul>
            )}
            {snoozed.length > 8 && <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing 8 of {snoozed.length} · <Link href="/tasks?view=mine&status=snoozed" className={cls.link}>All snoozed →</Link></div>}
          </Card>

          {can(user, "team") && (
            <Card title="Team workload" action={<Link href="/tasks?view=team" className={cls.link}>Team tasks</Link>}>
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] uppercase tracking-wide text-slate-500"><th className="px-4 py-1.5 text-left font-semibold">Person</th><th className="px-2 text-right font-semibold">Open</th><th className="px-2 text-right font-semibold">Late</th><th className="px-2 text-right font-semibold">Today</th><th className="px-4 text-right font-semibold">Done</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {team.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-1.5"><Link href={`/tasks?view=user&user=${m.id}`} className="hover:underline">{m.full_name}</Link>{m.urgent > 0 && <span className="ml-1.5"><Pill tone="red">{m.urgent} urgent</Pill></span>}</td>
                      <td className="px-2 text-right tabular-nums">{m.open}</td>
                      <td className={`px-2 text-right tabular-nums ${m.overdue > 10 ? "font-semibold text-rose-600" : m.overdue ? "text-rose-600" : "text-slate-500"}`}>{m.overdue}</td>
                      <td className="px-2 text-right tabular-nums">{m.due_today}</td>
                      <td className="px-4 text-right tabular-nums text-emerald-600">{m.done_today}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
