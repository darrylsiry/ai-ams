import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import Link from "next/link";
import { RangeBar } from "../parts";
import { Bars } from "@/components/charts";
import { Card, PageHeader, Status, Table, cls } from "@/components/ui";
import { money, yearStart } from "@/lib/format";
import { lobLabel } from "@/lib/ref";
import { expirations, lostBusiness, rangeFrom, retentionMonthly } from "@/lib/reports";

export const metadata = { title: "Renewals & retention" };

export default async function RenewalsReport({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("reports.all", "the renewals report", "principal, administrator or accounting");
  if (deny) return deny;
  const sp = await searchParams;
  const r = rangeFrom(sp, yearStart());
  const [monthly, lost, upcoming] = await Promise.all([retentionMonthly(r), lostBusiness(r), expirations(60)]);
  const atLost = paging(sp.page_lost, lost.length);
  const atUpcoming = paging(sp.page_upcoming, upcoming.length);
  return (
    <div>
      <PageHeader crumbs={[{ href: "/reports", label: "Reports" }]} title="Renewals & retention" subtitle={`Terms expiring ${r.from} to ${r.to}`} />
      <RangeBar r={r} path="/reports/renewals" csv="retention" />
      <Card title="Policy retention by month (%)" pad className="mb-5"><Bars ariaLabel="Policy retention percent by month" data={monthly.map((m) => ({ label: m.month, value: Number(m.retention_pct ?? 0), tip: `${m.month}: ${m.retention_pct}% (${m.renewed} of ${m.expiring}); avg rate change ${m.premium_change_pct ?? "—"}%` }))} /></Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="By month"><Table head={["Month", { label: "Expiring", num: true }, { label: "Renewed", num: true }, { label: "Lost", num: true }, { label: "Retention", num: true }, { label: "Avg rate change", num: true }]}>{monthly.map((m) => <tr key={m.month}><td className={cls.td}>{m.month}</td><td className={cls.num}>{m.expiring}</td><td className={cls.num}>{m.renewed}</td><td className={cls.num}>{m.lost}</td><td className={cls.num}>{m.retention_pct}%</td><td className={cls.num}>{m.premium_change_pct ? `${Number(m.premium_change_pct) >= 0 ? "+" : ""}${m.premium_change_pct}%` : "—"}</td></tr>)}</Table></Card>
        <Card title={`Lost business · ${lost.length} · ${money(lost.reduce((s, l) => s + Number(l.premium), 0))}`}><Table head={["Client", "Line", { label: "Premium", num: true }, "Expired", "Reason", "AM"]}>{pageOf(lost, atLost).map((l) => <tr key={l.policy_id}><td className={cls.td}><Link href={`/policies/${l.policy_id}`} className="hover:underline">{l.client}</Link></td><td className={`${cls.td} text-xs`}>{lobLabel(l.lob)}</td><td className={cls.num}>{money(l.premium)}</td><td className={`${cls.td} text-xs`}>{l.expiration_date}</td><td className={`${cls.td} text-xs`}>{l.reason ?? "—"}</td><td className={`${cls.td} text-xs`}>{l.am}</td></tr>)}</Table><Pager at={atLost} href={(page) => qs(sp, { page_lost: String(page) })} label="Lost business pages" /></Card>
        <Card title="Expiring in the next 60 days" className="lg:col-span-2"><Table head={["Expires", "Client", "Line", "Carrier", { label: "Premium", num: true }, "Stage", "Owner"]}>{pageOf(upcoming, atUpcoming).map((u) => <tr key={u.policy_id}><td className={`${cls.td} text-xs`}>{u.expiration_date}</td><td className={cls.td}><Link href={`/policies/${u.policy_id}?tab=renewal`} className="hover:underline">{u.client}</Link></td><td className={`${cls.td} text-xs`}>{lobLabel(u.lob)}</td><td className={`${cls.td} text-xs`}>{u.carrier}</td><td className={cls.num}>{money(u.premium)}</td><td className={cls.td}><Status s={u.stage} /></td><td className={`${cls.td} text-xs`}>{u.owner}</td></tr>)}</Table><Pager at={atUpcoming} href={(page) => qs(sp, { page_upcoming: String(page) })} label="Expiring policy pages" /></Card>
      </div>
    </div>
  );
}
