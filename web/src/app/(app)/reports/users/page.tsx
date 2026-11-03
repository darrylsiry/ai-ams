import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import Link from "next/link";
import { RangeBar } from "../parts";
import { Bars } from "@/components/charts";
import { Card, PageHeader, Pill, Stat, Table, cls } from "@/components/ui";
import { browserLabel } from "@/lib/login-meta";
import { auditByUser, rangeFrom, signinDaily, signinEvents, userSummary } from "@/lib/reports";
import { whenShort } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/user";

export const metadata = { title: "Users & sign-ins" };

export default async function UsersReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("admin", "the users and sign-ins report", "administrator");
  if (deny) return deny;
  const sp = await searchParams;
  const r = rangeFrom(sp);
  const username = sp.user || undefined;
  const [users, daily, events, actions] = await Promise.all([userSummary(r), signinDaily(r), signinEvents(r, username), username ? auditByUser(r, username) : Promise.resolve([])]);
  const who = users.find((u) => u.username === username);
  const atEvents = paging(sp.page_events, events.length);
  const atActions = paging(sp.page_actions, actions.length);
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title={who ? `Sign-ins & actions · ${who.user}` : "Users & sign-ins"} subtitle={`${r.from} to ${r.to} · sign-ins come from the sign-in page and API logins, with IP location`} />
      <RangeBar r={r} path="/reports/users" csv={username ? `signins&user=${username}` : "users"} extra={<select name="user" defaultValue={username ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Everyone</option>{users.map((u) => <option key={u.username} value={u.username}>{u.user}</option>)}</select>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Successful sign-ins" value={daily.reduce((s, d) => s + d.signins, 0)} />
        <Stat label="Failed attempts" value={daily.reduce((s, d) => s + d.failures, 0)} tone="red" />
        <Stat label="People active" value={users.filter((u) => u.signins).length} sub={`of ${users.filter((u) => u.active).length} active users`} />
        <Stat label="Never signed in (in range)" value={users.filter((u) => u.active && !u.signins).length} />
      </div>
      {!username && <>
        <Card title="People signed in per day" pad className="mb-5"><Bars ariaLabel="Distinct people signed in per day" data={daily.map((d) => ({ label: d.day.slice(5), value: d.users, tip: `${d.day}: ${d.users} people, ${d.signins} sign-ins, ${d.failures} failed` }))} /></Card>
        <Card title="By person" className="mb-5">
          <Table head={["Person", "Role", "Office", "Last sign-in", "Where", { label: "Sign-ins", num: true }, { label: "Failed", num: true }, { label: "Days active", num: true }, { label: "Tasks done", num: true }, { label: "Actions logged", num: true }, ""]}>
            {users.map((u) => <tr key={u.id} className={u.active ? "" : "opacity-50"}><td className={cls.td}><Link href={`/reports/users?user=${u.username}&from=${r.from}&to=${r.to}`} className={cls.link}>{u.user}</Link><div className="font-mono text-[11px] text-slate-400">{u.username}</div></td>
              <td className={`${cls.td} text-xs`}>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]}</td><td className={`${cls.td} text-xs`}>{u.branch}</td><td className={`${cls.td} text-xs`}>{u.last_signin ? whenShort(u.last_signin) : "never"}</td>
              <td className={`${cls.td} text-xs`}>{u.last_place || "—"}</td><td className={cls.num}>{u.signins}</td><td className={`${cls.num} ${u.failures ? "text-rose-600" : "text-slate-400"}`}>{u.failures}</td>
              <td className={cls.num}>{u.days_active}</td><td className={cls.num}>{u.completed}</td><td className={cls.num}>{u.audit_actions}</td><td className={cls.td}>{!u.active && <Pill>inactive</Pill>}</td></tr>)}
          </Table>
        </Card>
      </>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={`Sign-in events${username ? "" : " (latest 500)"}`}>
          <Table head={["When", "User", "Result", "IP", "Location", "Browser"]}>
            {pageOf(events, atEvents).map((e, i) => <tr key={i}><td className={`${cls.td} text-xs`}>{whenShort(e.occurred_at)}</td><td className={`${cls.td} text-xs`}>{e.username}</td><td className={cls.td}>{e.success ? <Pill tone="green">ok</Pill> : <Pill tone="red">failed</Pill>}</td>
              <td className={`${cls.td} font-mono text-[11px]`}>{e.ip ?? "—"}</td><td className={`${cls.td} text-xs`}>{e.place || "—"}</td><td className={`${cls.td} text-xs`}>{browserLabel(e.user_agent)}</td></tr>)}
          </Table><Pager at={atEvents} href={(page) => qs(sp, { page_events: String(page) })} label="Sign-in pages" />
        </Card>
        {username && <Card title="Actions in the system">
          <Table head={["When", "Action", "Summary"]}>{pageOf(actions, atActions).map((a, i) => <tr key={i}><td className={`${cls.td} text-xs`}>{whenShort(a.occurred_at)}</td><td className={`${cls.td} font-mono text-[11px]`}>{a.action}</td><td className={`${cls.td} text-xs`}>{a.summary}</td></tr>)}</Table><Pager at={atActions} href={(page) => qs(sp, { page_actions: String(page) })} label="Action pages" />
        </Card>}
      </div>
    </div>
  );
}
