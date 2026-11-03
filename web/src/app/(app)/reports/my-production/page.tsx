import { RangeBar } from "../parts";
import { Bars } from "@/components/charts";
import { Card, NoAccess, PageHeader, Stat, Table, cls } from "@/components/ui";
import { money, yearStart } from "@/lib/format";
import { myProductionBy, myProductionMonthly } from "@/lib/producer-reports";
import { rangeFrom } from "@/lib/reports";
import { currentUser } from "@/lib/user";

export const metadata = { title: "My production" };

export default async function MyProduction({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await currentUser();
  if (u.role !== "producer") return <NoAccess what="the My production report" roles="producer" />;
  const sp = await searchParams;
  const r = rangeFrom(sp, yearStart());
  const [monthly, byCarrier, byLob] = await Promise.all([myProductionMonthly(u.id, r), myProductionBy("carrier", u.id, r), myProductionBy("lob", u.id, r)]);
  const nb = monthly.reduce((s, m) => s + Number(m.new_premium), 0), rn = monthly.reduce((s, m) => s + Number(m.renewal_premium), 0);
  const nbCount = monthly.reduce((s, m) => s + m.new_count, 0);
  const table = (rows: typeof byCarrier, label: string) => <Table head={[label, { label: "New policies", num: true }, { label: "New premium", num: true }, { label: "All premium", num: true }, { label: "Commission", num: true }]} empty="No policies in this range.">{rows.map((x) => <tr key={x.key}><td className={cls.td}>{x.key}</td><td className={cls.num}>{x.new_count}</td><td className={cls.num}>{money(x.new_premium)}</td><td className={cls.num}>{money(x.total_premium)}</td><td className={cls.num}>{money(x.commission)}</td></tr>)}</Table>;
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title="My production" subtitle={`Your policies effective ${r.from} to ${r.to}`} />
      <RangeBar r={r} path="/reports/my-production" csv="my_production" />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New business premium" value={money(nb)} sub={`${nbCount} policies`} tone="green" /><Stat label="Renewal premium" value={money(rn)} />
        <Stat label="Estimated agency commission" value={money(monthly.reduce((s, m) => s + Number(m.commission), 0))} /><Stat label="Average new policy" value={money(nbCount ? nb / nbCount : 0)} />
      </div>
      <Card title="New business premium by month" pad className="mb-5"><Bars money ariaLabel="New business premium by month" data={monthly.map((m) => ({ label: m.month, value: Number(m.new_premium), tip: `${m.month}: ${money(m.new_premium)} new (${m.new_count}), ${money(m.renewal_premium)} renewal` }))} /></Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="By carrier">{table(byCarrier, "Carrier")}</Card>
        <Card title="By line of business">{table(byLob, "Line")}</Card>
      </div>
    </div>
  );
}
