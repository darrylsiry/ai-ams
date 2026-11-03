import { denied } from "@/components/gate";
import Link from "next/link";
import { NotInMvp } from "@/components/not-mvp";
import { Card, Flash, PageHeader, Stat, Status, Table, cls } from "@/components/ui";
import { aging, balances, carrierPayables, sweepable } from "@/lib/accounting";
import { one, q } from "@/lib/db";
import { money, todayISO } from "@/lib/format";

export const metadata = { title: "Accounting" };

export default async function Accounting({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const [b, sw, ag, payables, drafts, ytd] = await Promise.all([balances(), sweepable(), aging(), carrierPayables(),
    q<{ id: number; carrier: string; period: string; lines: number; unmatched: number; total: string }>(`SELECT cs.id, ca.name AS carrier, cs.period, (SELECT count(*)::int FROM commission_lines cl WHERE cl.statement_id = cs.id) AS lines,
      (SELECT count(*)::int FROM commission_lines cl WHERE cl.statement_id = cs.id AND cl.match_status IN ('unmatched','variance')) AS unmatched, cs.statement_total::text AS total
      FROM commission_statements cs JOIN carriers ca ON ca.id = cs.carrier_id WHERE cs.status = 'draft' ORDER BY cs.statement_date`),
    one<{ income: string; db: string; ab: string }>(`SELECT coalesce(sum(credit - debit) FILTER (WHERE account = 'commission_income'),0)::text AS income,
      coalesce(sum(credit - debit) FILTER (WHERE account = 'commission_income' AND ref_type = 'commission_statement'),0)::text AS db,
      coalesce(sum(credit - debit) FILTER (WHERE account = 'commission_income' AND ref_type = 'invoice'),0)::text AS ab FROM ledger_entries WHERE entry_date >= date_trunc('year', current_date)`)]);
  const ar = ag.reduce((s, r) => s + Number(r.total), 0);
  const past = ag.reduce((s, r) => s + Number(r.d30) + Number(r.d60) + Number(r.d90), 0);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Accounting" subtitle={`Insurance sub-ledger as of ${todayISO()}. The general ledger stays in QuickBooks: export journals from Ledger & export.`} actions={<NotInMvp id="GL-12" />} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Premium trust cash" value={money(b.trust_cash)} sub={`owed out: ${money(sw.owed)}`} href="/accounting/trust" />
        <Stat label="Available to sweep" value={money(sw.available)} tone={sw.available > 0 ? "green" : "slate"} href="/accounting/trust" />
        <Stat label="Client receivables" value={money(ar)} sub={`${money(past)} past due`} tone={past > 0 ? "amber" : "slate"} href="/accounting/invoices" />
        <Stat label="Commission income YTD" value={money(ytd!.income)} sub={`direct ${money(ytd!.db)} · agency ${money(ytd!.ab)}`} />
      </div>
      {sw.trust < sw.owed && <div className="mb-5 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 ring-1 ring-rose-200">Trust shortfall: trust cash is less than what is owed to carriers and states. Investigate before any further sweep.</div>}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Carrier payables (agency bill, collected)" action={<Link href="/accounting/payables" className={cls.link}>Pay statements</Link>}>
          <Table head={["Carrier", { label: "Items", num: true }, "Oldest", { label: "Owed", num: true }]} empty="Nothing collected is waiting to be paid.">
            {payables.map((p) => <tr key={p.carrier_id}><td className={cls.td}>{p.carrier}</td><td className={cls.num}>{p.lines}</td><td className={`${cls.td} text-xs`}>{p.oldest}</td><td className={cls.num}>{money(p.owed, true)}</td></tr>)}
          </Table>
        </Card>
        <Card title="Direct bill statements to reconcile" action={<Link href="/accounting/commissions" className={cls.link}>All statements</Link>}>
          <Table head={["Carrier", "Period", { label: "Lines", num: true }, { label: "Exceptions", num: true }, { label: "Total", num: true }]} empty="Every statement is posted.">
            {drafts.map((d) => <tr key={d.id}><td className={cls.td}><Link href={`/accounting/commissions/${d.id}`} className={cls.link}>{d.carrier}</Link></td><td className={`${cls.td} text-xs`}>{d.period}</td><td className={cls.num}>{d.lines}</td><td className={cls.num}>{d.unmatched ? <Status s="variance" /> : <Status s="matched" />} {d.unmatched || ""}</td><td className={cls.num}>{money(d.total, true)}</td></tr>)}
          </Table>
        </Card>
        <Card title="Receivables aging" action={<Link href="/accounting/invoices" className={cls.link}>Invoices</Link>} className="lg:col-span-2">
          <Table head={["Client", { label: "Current", num: true }, { label: "1–30", num: true }, { label: "31–60", num: true }, { label: "60+", num: true }, { label: "Total", num: true }]} empty="No open receivables.">
            {ag.slice(0, 12).map((r) => <tr key={r.client_id}><td className={cls.td}><Link href={`/clients/${r.client_id}?tab=billing`} className="hover:underline">{r.client}</Link></td>
              {[r.current, r.d30, r.d60, r.d90, r.total].map((v, i) => <td key={i} className={`${cls.num} ${i > 0 && i < 4 && Number(v) > 0 ? "text-rose-600" : ""}`}>{Number(v) ? money(v, true) : "—"}</td>)}</tr>)}
          </Table>
        </Card>
      </div>
    </div>
  );
}
