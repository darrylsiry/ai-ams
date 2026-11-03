import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import { Card, PageHeader, Table, cls } from "@/components/ui";
import { q } from "@/lib/db";
import { when, yearStart } from "@/lib/format";
import { maskPii } from "@/lib/redact";

export const metadata = { title: "Audit trail" };

export default async function Audit({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("admin", "the audit trail", "administrator");
  if (deny) return deny;
  const sp = await searchParams;
  const where: string[] = []; const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
  if (sp.actor) add("actor = ?", sp.actor);
  if (sp.type) add("entity_type = ?", sp.type);
  if (sp.id) add("entity_id = ?", sp.id);
  if (sp.q) add("(summary ILIKE '%' || ? || '%' OR action ILIKE '%' || ? || '%')", sp.q);
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await q<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events ${whereSql}`, params);
  const at = paging(sp.page, count[0].n);
  const rows = await q<{ id: number; occurred_at: Date; actor: string; action: string; entity_type: string; entity_id: string; summary: string; before: unknown; after: unknown }>(
    `SELECT id, occurred_at, actor, action, entity_type, entity_id, summary, before, after FROM audit_events ${whereSql} ORDER BY id DESC LIMIT ${at.size} OFFSET ${at.offset}`, params);
  const [actors, types] = await Promise.all([q<{ actor: string }>("SELECT DISTINCT actor FROM audit_events ORDER BY 1"), q<{ entity_type: string }>("SELECT DISTINCT entity_type FROM audit_events ORDER BY 1")]);
  const link = (t: string, id: string) => ({ client: `/clients/${id}`, policy: `/policies/${id}`, activity: `/tasks/${id}`, certificate: `/certificates/${id}`, claim: `/claims/${id}`, email: `/inbox/${id}`, opportunity: `/sales/${id}`, user: `/admin/users/${id}`, commission_statement: `/accounting/commissions/${id}` }[t]);
  return (
    <div>
      <PageHeader crumbs={[{ href: "/admin", label: "Admin" }]} title="Audit trail" subtitle="Append-only: the database refuses to edit or delete these rows." actions={<a href={`/reports/csv?r=audit&from=${yearStart()}${sp.actor ? `&user=${sp.actor}` : ""}`} className={cls.btn}>Download CSV</a>} />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="actor" defaultValue={sp.actor ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Anyone</option>{actors.map((a) => <option key={a.actor}>{a.actor}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Any record</option>{types.map((t) => <option key={t.entity_type}>{t.entity_type}</option>)}</select>
        <input name="q" defaultValue={sp.q} placeholder="Search summary or action" className={`${cls.inputInline} w-64`} /><button className={cls.btn}>Filter</button>
      </form>
      <Card><Table head={["When", "Who", "Action", "Record", "Summary"]}>
        {rows.map((r) => { const href = link(r.entity_type, r.entity_id); return <tr key={r.id}><td className={`${cls.td} whitespace-nowrap text-xs`}>{when(r.occurred_at)}</td><td className={`${cls.td} text-xs`}>{r.actor}</td><td className={`${cls.td} font-mono text-[11px]`}>{r.action}</td>
          <td className={`${cls.td} text-xs`}>{href ? <a href={href} className={cls.link}>{r.entity_type} {r.entity_id}</a> : `${r.entity_type} ${r.entity_id}`}</td>
          <td className={`${cls.td} text-xs`}>{r.summary}{(r.before || r.after) ? <details><summary className="text-[11px] text-indigo-600">changes</summary><pre className="mt-1 max-w-xl overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-[10px]">{JSON.stringify(maskPii({ before: r.before, after: r.after }), null, 1).slice(0, 3000)}</pre></details> : null}</td></tr>; })}
      </Table><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Audit pages" /></Card>
    </div>
  );
}
