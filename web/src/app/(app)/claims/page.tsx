import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import Link from "next/link";
import { Card, Empty, PageHeader, Stat, Status, Tabs, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { daysBetween, todayISO } from "@/lib/format";
import { lobLabel } from "@/lib/ref";
import { qs } from "@/lib/url";

export const metadata = { title: "Claims" };

export default async function Claims({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const claimFilter = status === "all" ? "" : "WHERE cl.status = $1";
  const claimParams = status === "all" ? [] : [status];
  const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM claims cl ${claimFilter}`, claimParams);
  const at = paging(sp.page, count!.n);
  const rows = await q<{ id: number; claim_number: string; carrier_claim_number: string | null; client_id: number; client_name: string; kind: string; loss_date: string; reported_date: string; status: string; lob: string | null; policy_number: string | null; adjuster_name: string | null; last_touch: Date | null; submitted: boolean }>(`
    SELECT cl.id, cl.claim_number, cl.carrier_claim_number, cl.client_id, c.name AS client_name, cl.kind, cl.loss_date, cl.reported_date, cl.status, p.lob, p.policy_number, cl.adjuster_name, cl.submitted_to_carrier_at IS NOT NULL AS submitted,
           (SELECT max(coalesce(a.completed_at, a.created_at)) FROM activities a WHERE a.claim_id = cl.id) AS last_touch
      FROM claims cl JOIN clients c ON c.id = cl.client_id LEFT JOIN policies p ON p.id = cl.policy_id ${claimFilter} ORDER BY cl.reported_date DESC, cl.id DESC LIMIT ${at.size} OFFSET ${at.offset}`, claimParams);
  const s = await one<{ open: number; ytd: number; unreported: number }>(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE reported_date >= date_trunc('year', current_date))::int AS ytd, count(*) FILTER (WHERE status = 'open' AND submitted_to_carrier_at IS NULL)::int AS unreported FROM claims`);
  const today = todayISO();
  return (
    <div>
      <PageHeader title="Claims" subtitle="Claims reported through the agency" actions={<Link href="/claims/new" className={cls.btnPrimary}>＋ Record claim</Link>} />
      <div className="mb-5 grid grid-cols-3 gap-3"><Stat label="Open claims" value={s!.open} /><Stat label="Not yet reported to carrier" value={s!.unreported} tone={s!.unreported ? "red" : "slate"} /><Stat label="Reported this year" value={s!.ytd} /></div>
      <Tabs current={status} tabs={[["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => ({ key: k, label: l, href: qs(sp, { status: k, page: undefined }) }))} />
      <Card>
        {rows.length === 0 ? <Empty>No claims.</Empty> : <div className="overflow-x-auto"><table className="w-full min-w-[880px]">
          <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{["Claim", "Client", "Type", "Loss date", "Policy", "Adjuster", "Last follow-up", "Status"].map((h) => <th key={h} className={cls.th}>{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r) => { const stale = r.status === "open" && r.last_touch ? daysBetween(new Date(r.last_touch), today) : null; return <tr key={r.id} className="hover:bg-slate-50/70">
            <td className={cls.td}><Link href={`/claims/${r.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{r.claim_number}</Link><div className={`font-mono text-[11px] ${r.carrier_claim_number ? "text-slate-500" : "text-rose-700"}`}>{r.carrier_claim_number ?? (r.submitted ? "" : "not reported")}</div></td>
            <td className={cls.td}><Link href={`/clients/${r.client_id}`} className="hover:underline">{r.client_name}</Link></td><td className={cls.td}>{r.kind}</td>
            <td className={`${cls.td} text-xs`}>{r.loss_date}</td><td className={`${cls.td} text-xs`}>{r.lob ? lobLabel(r.lob) : "—"}<div className="font-mono text-[11px] text-slate-400">{r.policy_number}</div></td>
            <td className={`${cls.td} text-xs`}>{r.adjuster_name ?? "—"}</td><td className={`${cls.td} text-xs ${stale !== null && stale > 14 ? "text-rose-600" : ""}`}>{stale !== null ? `${stale}d ago` : "—"}</td><td className={cls.td}><Status s={r.status} /></td>
          </tr>; })}</tbody></table></div>}
        <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Claim pages" />
      </Card>
    </div>
  );
}
