import { denied } from "@/components/gate";
import { buildProducerAction, payProducerAction } from "../actions";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, PageHeader, Status, Table, cls } from "@/components/ui";
import { q } from "@/lib/db";
import { money, todayISO } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Producer pay" };

export default async function Producers({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; id?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const user = await currentUser();
  const rows = await q<{ id: number; producer: string; period: string; status: string; total: string; lines: number; paid_at: Date | null; newb: string; ren: string; cb: string }>(`
    SELECT ps.id, u.full_name AS producer, ps.period, ps.status, ps.total::text, ps.paid_at, (SELECT count(*)::int FROM producer_statement_lines l WHERE l.statement_id = ps.id) AS lines,
           (SELECT coalesce(sum(amount),0)::text FROM producer_statement_lines l WHERE l.statement_id = ps.id AND kind = 'new') AS newb,
           (SELECT coalesce(sum(amount),0)::text FROM producer_statement_lines l WHERE l.statement_id = ps.id AND kind = 'renewal') AS ren,
           (SELECT coalesce(sum(amount),0)::text FROM producer_statement_lines l WHERE l.statement_id = ps.id AND kind = 'chargeback') AS cb
      FROM producer_statements ps JOIN users u ON u.id = ps.user_id ORDER BY ps.period DESC, u.full_name`);
  const detail = sp.id ? await q<{ policy_number: string; client: string; kind: string; agency_commission: string; split_pct: string; amount: string }>(`
    SELECT p.policy_number, c.name AS client, l.kind, l.agency_commission, l.split_pct, l.amount FROM producer_statement_lines l JOIN policies p ON p.id = l.policy_id JOIN clients c ON c.id = p.client_id WHERE l.statement_id = $1 ORDER BY c.name`, [Number(sp.id)]) : [];
  const lastMonth = new Date(`${todayISO().slice(0, 7)}-01T12:00:00Z`); lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Producer pay" subtitle="Producer share of agency commission received, by the split on each producer's profile (new vs renewal); cancellations charge back." actions={<NotInMvp id="COM-27" />} />
      {can(user, "accounting") && <Card pad className="mb-5"><form action={buildProducerAction} className="flex items-end gap-2"><Field label="Build statements for period"><input name="period" defaultValue={lastMonth.toISOString().slice(0, 7)} className={cls.input} /></Field><Submit className={cls.btnPrimary}>Build</Submit><span className="text-xs text-slate-500">Uses posted direct-bill statements and paid agency-bill invoices for the period.</span></form></Card>}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2"><Table head={["Producer", "Period", { label: "New", num: true }, { label: "Renewal", num: true }, { label: "Chargebacks", num: true }, { label: "Total", num: true }, "Status", ""]} empty="No statements.">
          {rows.map((r) => <tr key={r.id} className={String(r.id) === sp.id ? "bg-indigo-50/50" : ""}><td className={cls.td}><a href={`?id=${r.id}`} className={cls.link}>{r.producer}</a></td><td className={`${cls.td} text-xs`}>{r.period}</td>
            <td className={`${cls.num} text-xs`}>{money(r.newb, true)}</td><td className={`${cls.num} text-xs`}>{money(r.ren, true)}</td><td className={`${cls.num} text-xs text-rose-600`}>{Number(r.cb) ? money(r.cb, true) : "—"}</td>
            <td className={`${cls.num} font-medium`}>{money(r.total, true)}</td><td className={cls.td}><Status s={r.status} /></td>
            <td className={`${cls.td} text-right`}>{r.status === "draft" && Number(r.total) < 0 && <span className="text-xs text-slate-500">Nets off next statement</span>}{r.status === "draft" && Number(r.total) >= 0 && can(user, "accounting") && <form action={payProducerAction}><input type="hidden" name="id" value={r.id} /><Submit className={cls.btnSm} confirm={`Pay ${r.producer}'s ${r.period} statement, ${money(r.total, true)}?`}>Pay</Submit></form>}</td></tr>)}
        </Table></Card>
        <Card title="Statement lines">{detail.length === 0 ? <p className="p-4 text-sm text-slate-500">Pick a statement to see its lines.</p> : <Table head={["Policy", "Kind", { label: "Agency comm.", num: true }, { label: "Split", num: true }, { label: "Producer", num: true }]}>
          {detail.map((d, i) => <tr key={i}><td className={cls.td}><span className="font-mono text-[11px]">{d.policy_number}</span><div className="text-[11px] text-slate-500">{d.client}</div></td><td className={`${cls.td} text-xs`}>{d.kind}</td><td className={`${cls.num} text-xs`}>{money(d.agency_commission, true)}</td><td className={`${cls.num} text-xs`}>{Number(d.split_pct)}%</td><td className={`${cls.num} text-xs`}>{money(d.amount, true)}</td></tr>)}
        </Table>}</Card>
      </div>
    </div>
  );
}
