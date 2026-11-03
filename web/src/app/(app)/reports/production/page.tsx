import { denied } from "@/components/gate";
import { RangeBar } from "../parts";
import { Bars, HBars } from "@/components/charts";
import { Card, PageHeader, Stat, Table, cls } from "@/components/ui";
import { money, yearStart } from "@/lib/format";
import { productionBy, productionMonthly, rangeFrom } from "@/lib/reports";

export const metadata = { title: "Production report" };

export default async function Production({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("reports.all", "the production report", "principal, administrator or accounting");
  if (deny) return deny;
  const sp = await searchParams;
  const r = rangeFrom(sp, yearStart());
  const [monthly, byProducer, byCarrier, byLob, byBranch] = await Promise.all([productionMonthly(r), productionBy("producer", r), productionBy("carrier", r), productionBy("lob", r), productionBy("branch", r)]);
  const nb = monthly.reduce((s, m) => s + Number(m.new_premium), 0), rn = monthly.reduce((s, m) => s + Number(m.renewal_premium), 0);
  const nbCount = monthly.reduce((s, m) => s + m.new_count, 0);
  const table = (rows: typeof byProducer, label: string) => <Table head={[label, { label: "New policies", num: true }, { label: "New premium", num: true }, { label: "All premium", num: true }, { label: "Commission", num: true }]}>{rows.map((x) => <tr key={x.key}><td className={cls.td}>{x.key}</td><td className={cls.num}>{x.new_count}</td><td className={cls.num}>{money(x.new_premium)}</td><td className={cls.num}>{money(x.total_premium)}</td><td className={cls.num}>{money(x.commission)}</td></tr>)}</Table>;
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title="Production" subtitle={`Policies effective ${r.from} to ${r.to}`} />
      <RangeBar r={r} path="/reports/production" csv="production" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New business premium" value={money(nb)} sub={`${nbCount} policies`} tone="green" /><Stat label="Renewal premium" value={money(rn)} />
        <Stat label="Estimated commission" value={money(monthly.reduce((s, m) => s + Number(m.commission), 0))} /><Stat label="Average new policy" value={money(nbCount ? nb / nbCount : 0)} />
      </div>
      <Card title="New business premium by month" pad className="mb-5"><Bars money ariaLabel="New business premium by month" data={monthly.map((m) => ({ label: m.month, value: Number(m.new_premium), tip: `${m.month}: ${money(m.new_premium)} new (${m.new_count}), ${money(m.renewal_premium)} renewal` }))} /></Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="New business premium by producer"><HBars money data={byProducer.map((x) => ({ label: x.key, value: Number(x.new_premium) }))} />{table(byProducer, "Producer")}</Card>
        <Card title="New business premium by carrier"><HBars money data={byCarrier.slice(0, 10).map((x) => ({ label: x.key, value: Number(x.new_premium) }))} />{table(byCarrier, "Carrier")}</Card>
        <Card title="By line of business">{table(byLob, "Line")}</Card>
        <Card title="By office">{table(byBranch, "Office")}</Card>
      </div>
    </div>
  );
}
