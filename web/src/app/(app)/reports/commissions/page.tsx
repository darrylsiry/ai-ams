import { denied } from "@/components/gate";
import { RangeBar } from "../parts";
import { Bars } from "@/components/charts";
import { Card, PageHeader, Stat, Table, cls } from "@/components/ui";
import { money, yearStart } from "@/lib/format";
import { commissionByCarrier, commissionMonthly, rangeFrom } from "@/lib/reports";

export const metadata = { title: "Commission report" };

export default async function CommissionReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("accounting.view", "the commissions report", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const r = rangeFrom(sp, yearStart());
  const [monthly, carriers] = await Promise.all([commissionMonthly(r), commissionByCarrier(r)]);
  const total = monthly.reduce((s, m) => s + Number(m.total), 0);
  const received = carriers.reduce((s, c) => s + Number(c.received), 0), expected = carriers.reduce((s, c) => s + Number(c.expected), 0);
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title="Commissions" subtitle={`${r.from} to ${r.to}`} />
      <RangeBar r={r} path="/reports/commissions" csv="commissions" />
      <div className="mb-5 grid grid-cols-3 gap-3"><Stat label="Commission income posted" value={money(total)} /><Stat label="Direct bill received vs expected" value={`${expected ? ((received / expected) * 100).toFixed(1) : "—"}%`} sub={`${money(received)} of ${money(expected)}`} /><Stat label="Variance lines" value={carriers.reduce((s, c) => s + c.variance_lines, 0)} tone="amber" /></div>
      <Card title="Commission income by month" pad className="mb-5"><Bars money ariaLabel="Commission income by month" data={monthly.map((m) => ({ label: m.month, value: Number(m.total), tip: `${m.month}: ${money(m.total)} (direct ${money(m.direct_bill)}, agency ${money(m.agency_bill)})` }))} /></Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="By month"><Table head={["Month", { label: "Direct bill", num: true }, { label: "Agency bill", num: true }, { label: "Total", num: true }]}>{monthly.map((m) => <tr key={m.month}><td className={cls.td}>{m.month}</td><td className={cls.num}>{money(m.direct_bill)}</td><td className={cls.num}>{money(m.agency_bill)}</td><td className={`${cls.num} font-medium`}>{money(m.total)}</td></tr>)}</Table></Card>
        <Card title="Carrier statements"><Table head={["Carrier", { label: "Statements", num: true }, { label: "Received", num: true }, { label: "Expected", num: true }, { label: "Variance lines", num: true }]}>{carriers.map((c) => <tr key={c.carrier}><td className={cls.td}>{c.carrier}</td><td className={cls.num}>{c.statements}</td><td className={cls.num}>{money(c.received)}</td><td className={cls.num}>{money(c.expected)}</td><td className={cls.num}>{c.variance_lines}</td></tr>)}</Table></Card>
      </div>
    </div>
  );
}
