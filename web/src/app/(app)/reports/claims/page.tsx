import { yearStart } from "@/lib/format";
import { denied } from "@/components/gate";
import { RangeBar } from "../parts";
import { HBars } from "@/components/charts";
import { Card, PageHeader, Table, cls } from "@/components/ui";
import { claimsBy, rangeFrom } from "@/lib/reports";

export const metadata = { title: "Claims report" };

export default async function ClaimsReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("reports.all", "the claims report", "principal, administrator or accounting");
  if (deny) return deny;
  const sp = await searchParams;
  const r = rangeFrom(sp, yearStart());
  const rows = await claimsBy(r);
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title="Claims" subtitle={`Reported ${r.from} to ${r.to}`} />
      <RangeBar r={r} path="/reports/claims" csv="claims" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Claims reported by type"><HBars data={rows.map((x) => ({ label: x.kind, value: x.reported }))} /></Card>
        <Card><Table head={["Type", { label: "Reported", num: true }, { label: "Open", num: true }, { label: "Median days open", num: true }]}>{rows.map((x) => <tr key={x.kind}><td className={cls.td}>{x.kind}</td><td className={cls.num}>{x.reported}</td><td className={cls.num}>{x.open}</td><td className={cls.num}>{x.median_days_open}</td></tr>)}</Table></Card>
      </div>
    </div>
  );
}
