import Link from "next/link";
import { Card, Empty, PageHeader, Status, Tabs, cls } from "@/components/ui";
import { NotInMvp } from "@/components/not-mvp";
import { Pager } from "@/components/pager";
import { one, q } from "@/lib/db";
import { daysBetween, money, todayISO } from "@/lib/format";
import { paging } from "@/lib/paging";
import { LOBS, lobLabel } from "@/lib/ref";
import { activeUsers, currentUser } from "@/lib/user";
import { qs } from "@/lib/url";

export const metadata = { title: "Policies" };

type Row = { id: number; policy_number: string; lob: string; status: string; effective_date: string; expiration_date: string; premium: string; bill_mode: string; client_id: number; client_name: string; carrier: string; am: string | null; new_renewal: string; issued_at: Date | null; policy_checked_at: Date | null };

export default async function Policies({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const status = sp.status ?? "inforce";
  const where: string[] = []; const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
  if (status === "inforce") where.push("p.status IN ('active','bound','pending_cancel')");
  else if (status === "unchecked") where.push("p.status IN ('active','bound') AND p.policy_checked_at IS NULL AND p.effective_date >= date_trunc('year', current_date)");
  else if (status !== "all") add("p.status = ?", status);
  if (sp.lob) add("p.lob = ?", sp.lob);
  if (sp.carrier) add("p.carrier_id = ?", Number(sp.carrier));
  if (sp.bill) add("p.bill_mode = ?", sp.bill);
  if (sp.mine === "1") add("p.account_manager_id = ?", user.id);
  if (sp.q) add("(p.policy_number ILIKE '%' || ? || '%' OR c.name ILIKE '%' || ? || '%')", sp.q);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const totals = await one<{ n: number; premium: string }>(`SELECT count(*)::int AS n, coalesce(sum(p.premium), 0)::text AS premium FROM policies p JOIN clients c ON c.id = p.client_id ${whereSql}`, params);
  const at = paging(sp.page, totals!.n);
  const rows = await q<Row>(`SELECT p.id, p.policy_number, p.lob, p.status, p.effective_date, p.expiration_date, p.premium, p.bill_mode, p.client_id, c.name AS client_name, ca.name AS carrier, u.full_name AS am, p.new_renewal, p.issued_at, p.policy_checked_at
    FROM policies p JOIN clients c ON c.id = p.client_id JOIN carriers ca ON ca.id = p.carrier_id LEFT JOIN users u ON u.id = p.account_manager_id
    ${whereSql} ORDER BY p.expiration_date ${status === "inforce" ? "ASC" : "DESC"}, p.id LIMIT ${at.size} OFFSET ${at.offset}`, params);
  const carriers = await q<{ id: number; name: string }>("SELECT id, name FROM carriers WHERE kind <> 'wholesaler' ORDER BY name");
  const today = todayISO();
  void activeUsers;
  return (
    <div>
      <PageHeader title="Policies" subtitle={`${at.total} ${at.total === 1 ? "policy" : "policies"} · ${money(totals!.premium)} premium`}
        actions={<><NotInMvp id="CON-01" label="Carrier download" /><Link href="/policies/new" className={cls.btnPrimary}>＋ New policy</Link></>} />
      <Tabs current={status} tabs={[["inforce", "In force"], ["bound", "Bound, not issued"], ["unchecked", "Not yet checked"], ["pending_cancel", "Pending cancel"], ["cancelled", "Cancelled"], ["expired", "Expired"], ["lost", "Lost"], ["all", "All"]].map(([k, l]) => ({ key: k, label: l, href: qs(sp, { status: k, page: undefined }) }))} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={sp.q} placeholder="Policy number or client" className={`${cls.inputInline} w-64`} />
        <select name="lob" defaultValue={sp.lob ?? ""} className={`${cls.inputInline} w-auto`}><option value="">All lines</option>{Object.entries(LOBS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <select name="carrier" defaultValue={sp.carrier ?? ""} className={`${cls.inputInline} w-auto`}><option value="">All carriers</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select name="bill" defaultValue={sp.bill ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Agency &amp; direct bill</option><option value="agency">Agency bill</option><option value="direct">Direct bill</option></select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> My accounts</label>
        <button className={cls.btn}>Filter</button>
      </form>
      <Card>
        {rows.length === 0 ? <Empty>No policies match.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[960px]">
            <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{["Policy", "Client", "Line", "Carrier", "Term", "Premium", "Account manager", "Status"].map((h) => <th key={h} className={h === "Premium" ? `${cls.th} text-right` : cls.th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((r) => {
              const left = daysBetween(today, r.expiration_date);
              return <tr key={r.id} className="hover:bg-slate-50/70">
                <td className={cls.td}><Link href={`/policies/${r.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{r.policy_number}</Link><div className="text-[11px] text-slate-400">{r.new_renewal}{r.bill_mode === "agency" ? " · agency bill" : ""}</div></td>
                <td className={cls.td}><Link href={`/clients/${r.client_id}`} className="hover:underline">{r.client_name}</Link></td>
                <td className={cls.td}>{lobLabel(r.lob)}</td><td className={`${cls.td} text-xs`}>{r.carrier}</td>
                <td className={`${cls.td} text-xs tabular-nums`}>{r.effective_date} → {r.expiration_date}{["active", "pending_cancel"].includes(r.status) && left <= 60 && <span className={`ml-1 ${left <= 30 ? "text-rose-600" : "text-amber-600"}`}>({left}d)</span>}</td>
                <td className={cls.num}>{money(r.premium)}</td><td className={`${cls.td} text-xs`}>{r.am}</td>
                <td className={cls.td}><Status s={r.status} />{status === "unchecked" && <div className="text-[11px] text-amber-600">not checked</div>}</td>
              </tr>;
            })}</tbody>
          </table></div>
        )}
        <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Policy pages" />
      </Card>
    </div>
  );
}
