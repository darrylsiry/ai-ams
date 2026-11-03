import { Card, NoAccess, PageHeader, Stat, Status, Table, cls } from "@/components/ui";
import { money } from "@/lib/format";
import { myStatementLines, myStatements } from "@/lib/producer-reports";
import { currentUser } from "@/lib/user";

export const metadata = { title: "My commission statements" };

export default async function MyCommissions({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const u = await currentUser();
  if (u.role !== "producer") return <NoAccess what="your commission statements" roles="producer" />;
  const sp = await searchParams;
  const [rows, detail] = await Promise.all([myStatements(u.id), sp.id ? myStatementLines(u.id, Number(sp.id) || 0) : Promise.resolve([])]);
  const sum = (status: string) => rows.filter((r) => r.status === status).reduce((s, r) => s + Number(r.total), 0);
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title="My commission statements" subtitle="Your share of the commission the agency has received. A draft can still change until accounting pays it." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4"><Stat label="Paid to you" value={money(sum("paid"), true)} /><Stat label="In draft" value={money(sum("draft"), true)} /></div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2"><Table head={["Period", { label: "New", num: true }, { label: "Renewal", num: true }, { label: "Chargebacks", num: true }, { label: "Total", num: true }, "Status"]} empty="No statements yet.">
          {rows.map((r) => <tr key={r.id} className={String(r.id) === sp.id ? "bg-indigo-50/50" : ""}><td className={cls.td}><a href={`?id=${r.id}`} className={cls.link}>{r.period}</a></td>
            <td className={`${cls.num} text-xs`}>{money(r.newb, true)}</td><td className={`${cls.num} text-xs`}>{money(r.ren, true)}</td><td className={`${cls.num} text-xs text-rose-600`}>{Number(r.cb) ? money(r.cb, true) : "—"}</td>
            <td className={`${cls.num} font-medium`}>{money(r.total, true)}</td><td className={cls.td}><Status s={r.status} /></td></tr>)}
        </Table></Card>
        <Card title="Statement lines">{detail.length === 0 ? <p className="p-4 text-sm text-slate-500">Pick a statement to see its lines.</p> : <Table head={["Policy", "Kind", { label: "Agency comm.", num: true }, { label: "Split", num: true }, { label: "Yours", num: true }]}>
          {detail.map((d, i) => <tr key={i}><td className={cls.td}><span className="font-mono text-[11px]">{d.policy_number}</span><div className="text-[11px] text-slate-500">{d.client}</div></td><td className={`${cls.td} text-xs`}>{d.kind}</td><td className={`${cls.num} text-xs`}>{money(d.agency_commission, true)}</td><td className={`${cls.num} text-xs`}>{Number(d.split_pct)}%</td><td className={`${cls.num} text-xs`}>{money(d.amount, true)}</td></tr>)}
        </Table>}</Card>
      </div>
    </div>
  );
}
