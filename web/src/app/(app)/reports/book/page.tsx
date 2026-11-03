import { denied } from "@/components/gate";
import { HBars } from "@/components/charts";
import { Card, PageHeader, Stat, Table, cls } from "@/components/ui";
import { money } from "@/lib/format";
import { bookBy } from "@/lib/reports";

export const metadata = { title: "Book of business" };

export default async function Book() {
  const deny = await denied("reports.all", "the book report", "principal, administrator or accounting");
  if (deny) return deny;
  const [lob, carrier, am, type] = await Promise.all([bookBy("lob"), bookBy("carrier"), bookBy("am"), bookBy("type")]);
  const total = lob.reduce((s, x) => s + Number(x.premium), 0);
  const t = (rows: typeof lob, label: string) => <Table head={[label, { label: "Policies", num: true }, { label: "Clients", num: true }, { label: "Premium", num: true }, { label: "Share", num: true }, { label: "Commission", num: true }]}>{rows.map((x) => <tr key={x.key}><td className={cls.td}>{x.key}</td><td className={cls.num}>{x.policies}</td><td className={cls.num}>{x.clients}</td><td className={cls.num}>{money(x.premium)}</td><td className={cls.num}>{((Number(x.premium) / total) * 100).toFixed(1)}%</td><td className={cls.num}>{money(x.commission)}</td></tr>)}</Table>;
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title="Book of business" subtitle="Everything in force today" actions={<a href="/reports/csv?r=book" className="text-sm text-indigo-600">Download CSV</a>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="In-force premium" value={money(total)} /><Stat label="Policies" value={lob.reduce((s, x) => s + x.policies, 0)} />
        {type.map((x) => <Stat key={x.key} label={x.key === "personal" ? "Personal lines premium" : "Commercial premium"} value={money(x.premium)} sub={`${x.policies} policies`} />)}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Premium by line"><HBars money data={lob.map((x) => ({ label: x.key, value: Number(x.premium) }))} />{t(lob, "Line")}</Card>
        <Card title="Premium by carrier"><HBars money data={carrier.map((x) => ({ label: x.key, value: Number(x.premium) }))} />{t(carrier, "Carrier")}</Card>
        <Card title="By account manager" className="lg:col-span-2">{t(am, "Account manager")}</Card>
      </div>
    </div>
  );
}
