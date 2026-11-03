import Link from "next/link";
import { NotInMvp } from "@/components/not-mvp";
import { Pager } from "@/components/pager";
import { Card, Empty, PageHeader, Pill, Stat, Status, Tabs, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { whenShort } from "@/lib/format";
import { paging } from "@/lib/paging";
import { qs } from "@/lib/url";

export const metadata = { title: "Certificates" };

export default async function Certs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const status = sp.status ?? "issued";
  const params: unknown[] = []; const where: string[] = [];
  if (status !== "all") { params.push(status); where.push(`ce.status = $${params.length}`); }
  if (sp.q) { params.push(sp.q); where.push(`(c.name ILIKE '%' || $${params.length} || '%' OR oi.name ILIKE '%' || $${params.length} || '%' OR ce.cert_number ILIKE '%' || $${params.length} || '%')`); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM certificates ce JOIN clients c ON c.id = ce.client_id LEFT JOIN other_interests oi ON oi.id = ce.holder_id ${whereSql}`, params);
  const at = paging(sp.page, count!.n);
  const rows = await q<{ id: number; cert_number: string; client_id: number; client_name: string; holder: string | null; status: string; issued_at: Date | null; by: string | null; ai: boolean; wos: boolean; pnc: boolean; expiring: string | null }>(`
    SELECT ce.id, ce.cert_number, ce.client_id, c.name AS client_name, oi.name AS holder, ce.status, ce.issued_at, u.full_name AS by, ce.additional_insured AS ai, ce.waiver_of_subrogation AS wos, ce.primary_noncontributory AS pnc,
           (SELECT min(p.expiration_date) FROM certificate_policies cp JOIN policies p ON p.id = cp.policy_id WHERE cp.certificate_id = ce.id) AS expiring
      FROM certificates ce JOIN clients c ON c.id = ce.client_id LEFT JOIN other_interests oi ON oi.id = ce.holder_id LEFT JOIN users u ON u.id = ce.issued_by_id
     ${whereSql} ORDER BY ce.issued_at DESC NULLS FIRST, ce.id DESC LIMIT ${at.size} OFFSET ${at.offset}`, params);
  const stats = await one<{ month: number; open: number; holders: number }>(`SELECT (SELECT count(*)::int FROM certificates WHERE issued_at >= date_trunc('month', now())) AS month,
     (SELECT count(*)::int FROM activities WHERE code = 'CERT-REQ' AND status IN ('open','waiting')) AS open, (SELECT count(*)::int FROM other_interests WHERE kind = 'certificate_holder') AS holders`);
  return (
    <div>
      <PageHeader title="Certificates" subtitle="Certificates of liability insurance and evidence of property"
        actions={<><NotInMvp id="CRT-11" /><NotInMvp id="CRT-12" /><Link href="/certificates/new" className={cls.btnPrimary}>＋ Issue certificate</Link></>} />
      <div className="mb-5 grid grid-cols-3 gap-3"><Stat label="Issued this month" value={stats!.month} /><Stat label="Open certificate requests" value={stats!.open} tone={stats!.open ? "amber" : "slate"} href="/tasks?view=team&category=Certificate" /><Stat label="Holders on file" value={stats!.holders} /></div>
      <Tabs current={status} tabs={[["issued", "Current"], ["superseded", "Superseded"], ["revoked", "Revoked"], ["all", "All"]].map(([k, l]) => ({ key: k, label: l, href: qs(sp, { status: k, page: undefined }) }))} />
      <form className="mb-4 flex gap-2"><input type="hidden" name="status" value={status} /><input name="q" defaultValue={sp.q} placeholder="Client, holder or certificate number" className={`${cls.inputInline} w-80`} /><button className={cls.btn}>Search</button></form>
      <Card>
        {rows.length === 0 ? <Empty>No certificates.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[860px]">
            <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{["Certificate", "Insured", "Holder", "Wording", "Earliest expiration", "Issued", "Status", ""].map((h) => <th key={h} className={cls.th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((r) => <tr key={r.id} className="hover:bg-slate-50/70">
              <td className={cls.td}><Link href={`/certificates/${r.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{r.cert_number}</Link></td>
              <td className={cls.td}><Link href={`/clients/${r.client_id}`} className="hover:underline">{r.client_name}</Link></td><td className={cls.td}>{r.holder}</td>
              <td className={cls.td}><span className="flex flex-wrap gap-1">{r.ai && <Pill>Add&apos;l insured</Pill>}{r.wos && <Pill>Waiver</Pill>}{r.pnc && <Pill>Primary/NC</Pill>}</span></td>
              <td className={`${cls.td} text-xs`}>{r.expiring ?? "—"}</td><td className={`${cls.td} text-xs`}>{r.issued_at ? whenShort(r.issued_at) : "—"}<div className="text-slate-400">{r.by}</div></td>
              <td className={cls.td}><Status s={r.status} /></td><td className={`${cls.td} text-right`}><a href={`/documents/render?kind=certificate&certificate=${r.id}`} className={cls.btnSm}>PDF</a></td>
            </tr>)}</tbody>
          </table></div>
        )}
        <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Certificate pages" />
      </Card>
    </div>
  );
}
