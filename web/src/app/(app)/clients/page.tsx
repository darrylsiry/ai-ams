import Link from "next/link";
import { Pager } from "@/components/pager";
import { Card, Empty, PageHeader, Pill, Status, Tabs, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { money } from "@/lib/format";
import { paging } from "@/lib/paging";
import { activeUsers, currentUser } from "@/lib/user";
import { qs } from "@/lib/url";

export const metadata = { title: "Clients" };

type Row = { id: number; code: string; name: string; kind: string; status: string; city: string | null; state: string | null; industry: string | null; am: string | null; producer: string | null;
  premium: string; policies: number; open_tasks: number; next_exp: string | null; tags: string[] };

export default async function Clients({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const status = sp.status ?? "insured";
  const where: string[] = []; const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
  if (status !== "all") add("c.status = ?", status);
  if (sp.kind) add("c.kind = ?", sp.kind);
  if (sp.mine === "1") add("(c.account_manager_id = ? OR c.producer_id = ? OR c.csr_id = ?)", user.id);
  if (sp.am) add("c.account_manager_id = ?", Number(sp.am));
  if (sp.q) add("(c.name ILIKE '%' || ? || '%' OR c.code ILIKE '%' || ? || '%' OR c.email ILIKE '%' || ? || '%' OR c.phone ILIKE '%' || ? || '%' OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.client_id = c.id AND (ct.email ILIKE '%' || ? || '%' OR (ct.first_name || ' ' || ct.last_name) ILIKE '%' || ? || '%')))", sp.q);
  if (sp.tag) add("? = ANY(c.tags)", sp.tag);
  const sort = { name: "c.name", premium: "premium DESC", exp: "next_exp NULLS LAST", tasks: "open_tasks DESC" }[sp.sort ?? "name"] ?? "c.name";
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM clients c ${whereSql}`, params);
  const at = paging(sp.page, count!.n);
  const rows = await q<Row>(`
    SELECT c.id, c.code, c.name, c.kind, c.status, c.city, c.state, c.industry, am.full_name AS am, pr.full_name AS producer, c.tags,
           coalesce(sum(p.premium) FILTER (WHERE p.status IN ('active','bound','pending_cancel')),0)::text AS premium,
           count(p.*) FILTER (WHERE p.status IN ('active','bound','pending_cancel'))::int AS policies,
           (SELECT count(*)::int FROM activities a WHERE a.client_id = c.id AND a.status IN ('open','waiting')) AS open_tasks,
           min(p.expiration_date) FILTER (WHERE p.status IN ('active','pending_cancel') AND p.renewal_policy_id IS NULL) AS next_exp
      FROM clients c LEFT JOIN policies p ON p.client_id = c.id LEFT JOIN users am ON am.id = c.account_manager_id LEFT JOIN users pr ON pr.id = c.producer_id
     ${whereSql} GROUP BY c.id, am.full_name, pr.full_name ORDER BY ${sort}, c.id LIMIT ${at.size} OFFSET ${at.offset}`, params);
  const users = await activeUsers();
  return (
    <div>
      <PageHeader title="Clients" subtitle={`${at.total} ${status === "all" ? "accounts" : status === "prospect" ? "prospects" : status === "inactive" ? "inactive accounts" : "insureds"}`}
        actions={<Link href="/clients/new" className={cls.btnPrimary}>＋ New client</Link>} />
      <Tabs current={status} tabs={[["insured", "Insureds"], ["prospect", "Prospects"], ["inactive", "Inactive"], ["all", "All"]].map(([k, l]) => ({ key: k, label: l, href: qs(sp, { status: k, page: undefined }) }))} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="status" value={status} />
        <input name="q" defaultValue={sp.q} placeholder="Name, code, email, phone, contact…" className={`${cls.inputInline} w-72`} />
        <select name="kind" defaultValue={sp.kind ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Personal &amp; commercial</option><option value="individual">Personal</option><option value="business">Commercial</option></select>
        <select name="am" defaultValue={sp.am ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Any account manager</option>{users.filter((u) => u.role === "account_manager").map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
        <select name="sort" defaultValue={sp.sort ?? "name"} className={`${cls.inputInline} w-auto`}><option value="name">Sort: name</option><option value="premium">Premium</option><option value="exp">Next expiration</option><option value="tasks">Open tasks</option></select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> My book</label>
        <button className={cls.btn}>Search</button>
      </form>
      <Card>
        {rows.length === 0 ? <Empty>No clients match.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[900px]">
            <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{["Client", "Type", "Account manager", "In-force premium", "Policies", "Next expiration", "Open tasks", "Status"].map((h) => <th key={h} className={["In-force premium", "Policies", "Open tasks"].includes(h) ? `${cls.th} text-right` : cls.th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/70">
                  <td className={cls.td}><Link href={`/clients/${r.id}`} className="font-medium text-slate-900 hover:text-indigo-700">{r.name}</Link>
                    <div className="text-xs text-slate-500">{r.code} · {r.city}, {r.state}{r.tags.map((t) => <span key={t} className="ml-1"><Pill>{t}</Pill></span>)}</div></td>
                  <td className={`${cls.td} text-xs`}>{r.kind === "individual" ? "Personal" : r.industry ?? "Commercial"}</td>
                  <td className={`${cls.td} text-xs`}>{r.am ?? "—"}<div className="text-slate-400">{r.producer}</div></td>
                  <td className={cls.num}>{money(r.premium)}</td>
                  <td className={cls.num}>{r.policies}</td>
                  <td className={`${cls.td} text-xs tabular-nums`}>{r.next_exp ?? "—"}</td>
                  <td className={cls.num}>{r.open_tasks || ""}</td>
                  <td className={cls.td}><Status s={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Client pages" />
      </Card>
    </div>
  );
}
