import { denied } from "@/components/gate";
import { RangeBar } from "../parts";
import { Bars, HBars } from "@/components/charts";
import { Card, PageHeader, Stat, Table, cls } from "@/components/ui";
import { emailByType, emailDaily, emailStats, rangeFrom } from "@/lib/reports";

export const metadata = { title: "Email intake report" };

export default async function EmailReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("reports.all", "the email report", "principal, administrator or accounting");
  if (deny) return deny;
  const sp = await searchParams;
  const r = rangeFrom(sp);
  const [daily, stats, types] = await Promise.all([emailDaily(r), emailStats(r), emailByType(r)]);
  const received = daily.reduce((s, d) => s + d.received, 0), ai = daily.reduce((s, d) => s + d.ai, 0), matched = daily.reduce((s, d) => s + d.matched, 0);
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title="Email intake" subtitle={`${r.from} to ${r.to}`} />
      <RangeBar r={r} path="/reports/email" csv="email" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Emails received" value={received} /><Stat label="Classified by Claude" value={received ? `${Math.round((ai / received) * 100)}%` : "—"} sub="the rest by keyword rules" />
        <Stat label="Matched to a client" value={received ? `${Math.round((matched / received) * 100)}%` : "—"} tone="green" /><Stat label="Waiting for triage" value={stats.reduce((s, x) => s + x.triage, 0)} href="/inbox" tone="indigo" />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Emails received per day" pad className="lg:col-span-2"><Bars ariaLabel="Emails received per day" data={daily.map((d) => ({ label: d.day.slice(5), value: d.received, tip: `${d.day}: ${d.received} received, ${d.matched} matched, ${d.ai} by Claude` }))} /></Card>
        <Card title="What the emails asked for"><HBars data={types.slice(0, 12).map((t) => ({ label: t.label, value: t.n }))} /></Card>
      </div>
      <Card title="By person routed to" className="mt-5"><Table head={["Person", { label: "Received", num: true }, { label: "Forwarded by them", num: true }, { label: "Client matched", num: true }, { label: "Confident (no triage)", num: true }, { label: "Waiting triage", num: true }, { label: "Median hours email → done", num: true }]}>
        {stats.map((s) => <tr key={s.user}><td className={cls.td}>{s.user}</td><td className={cls.num}>{s.received}</td><td className={cls.num}>{s.forwarded}</td><td className={cls.num}>{s.matched_pct}%</td><td className={cls.num}>{s.actioned}</td><td className={cls.num}>{s.triage}</td><td className={cls.num}>{s.median_hours_to_done ?? "—"}</td></tr>)}
      </Table></Card>
    </div>
  );
}
