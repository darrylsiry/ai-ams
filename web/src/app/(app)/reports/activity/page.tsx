import { denied } from "@/components/gate";
import Link from "next/link";
import { RangeBar } from "../parts";
import { Bars, HBars } from "@/components/charts";
import { Card, PageHeader, Stat, Table, cls } from "@/components/ui";
import { activityByType, activityByUser, activityDaily, activitySources, rangeFrom } from "@/lib/reports";
import { ROLE_LABEL } from "@/lib/user";

export const metadata = { title: "Activity report" };

export default async function ActivityReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("reports.all", "the activity report", "principal, administrator or accounting");
  if (deny) return deny;
  const sp = await searchParams;
  const r = rangeFrom(sp);
  const userId = Number(sp.user) || undefined;
  const [byUser, daily, byType, sources] = await Promise.all([activityByUser(r), activityDaily(r, userId), activityByType(r, userId), activitySources(r)]);
  const team = byUser.filter((u) => u.created || u.completed || u.open_now);
  const completed = daily.reduce((s, d) => s + d.completed, 0), created = daily.reduce((s, d) => s + d.created, 0);
  const onTime = team.reduce((s, u) => s + u.on_time, 0), done = team.reduce((s, u) => s + u.completed, 0);
  const who = userId ? byUser.find((u) => u.user_id === userId)?.user : null;
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title={`Activity${who ? ` · ${who}` : ""}`} subtitle={`${r.from} to ${r.to}`} />
      <RangeBar r={r} path="/reports/activity" csv="activity" extra={<select name="user" defaultValue={sp.user ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Everyone</option>{byUser.map((u) => <option key={u.user_id} value={u.user_id}>{u.user}</option>)}</select>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Tasks completed" value={completed.toLocaleString()} />
        <Stat label="Tasks created" value={created.toLocaleString()} />
        <Stat label="Completed on time" value={done ? `${Math.round((onTime / done) * 100)}%` : "—"} tone="green" />
        <Stat label="Open now" value={team.reduce((s, u) => s + u.open_now, 0)} />
        <Stat label="Overdue now" value={team.reduce((s, u) => s + u.overdue_now, 0)} tone="red" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Tasks completed per day" className="lg:col-span-2" pad><Bars ariaLabel="Tasks completed per day" data={daily.map((d) => ({ label: d.day.slice(5), value: d.completed, tip: `${d.day}: ${d.completed} completed, ${d.created} created` }))} /></Card>
        <Card title="Where work came from"><HBars data={sources.map((s) => ({ label: s.source === "email" ? "Email" : s.source === "automation" ? "Daily automation" : s.source === "system" ? "System (policy events)" : s.source === "lead" ? "Leads" : "Created by hand", value: s.n }))} /></Card>
      </div>
      {!userId && <Card title="By person" className="mt-5">
        <Table head={["Person", "Role", { label: "Completed", num: true }, { label: "On time", num: true }, { label: "From email", num: true }, { label: "Median hours to done", num: true }, { label: "Notes", num: true }, { label: "Open now", num: true }, { label: "Overdue now", num: true }]}>
          {team.map((u) => <tr key={u.user_id}><td className={cls.td}><Link href={`/reports/activity?user=${u.user_id}&from=${r.from}&to=${r.to}`} className={cls.link}>{u.user}</Link></td><td className={`${cls.td} text-xs`}>{ROLE_LABEL[u.role as keyof typeof ROLE_LABEL]}</td>
            <td className={`${cls.num} font-medium`}>{u.completed}</td><td className={cls.num}>{u.completed ? `${Math.round((u.on_time / u.completed) * 100)}%` : "—"}</td><td className={cls.num}>{u.from_email}</td>
            <td className={cls.num}>{u.median_hours ?? "—"}</td><td className={cls.num}>{u.notes}</td><td className={cls.num}>{u.open_now}</td><td className={`${cls.num} ${u.overdue_now > 10 ? "font-semibold text-rose-600" : ""}`}>{u.overdue_now}</td></tr>)}
        </Table>
      </Card>}
      <Card title="By type of work" className="mt-5">
        <Table head={["Category", "Type", { label: "Completed", num: true }, { label: "Median hours", num: true }, { label: "On time", num: true }, { label: "Service standard", num: true }, { label: "Standard met", num: true }]}>
          {byType.map((t) => <tr key={t.label}><td className={`${cls.td} text-xs`}>{t.category}</td><td className={cls.td}>{t.label}</td><td className={cls.num}>{t.completed}</td><td className={cls.num}>{t.median_hours}</td><td className={cls.num}>{t.on_time_pct}%</td><td className={`${cls.num} text-xs`}>{t.sla_hours ? `${t.sla_hours}h` : "—"}</td><td className={cls.num}>{t.sla_met_pct ? `${t.sla_met_pct}%` : "—"}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}
