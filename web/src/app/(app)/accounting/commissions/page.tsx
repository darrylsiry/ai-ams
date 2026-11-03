import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import Link from "next/link";
import { newStatementAction } from "../actions";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, PageHeader, Pill, Status, Table, cls } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import { one, q } from "@/lib/db";
import { money, todayISO } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Direct bill commissions" };

export default async function Commissions({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; page?: string; page_missing?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const user = await currentUser();
  const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM commission_statements");
  const at = paging(sp.page, count!.n);
  const [rows, carriers, unpaid] = await Promise.all([
    q<{ id: number; carrier: string; period: string; statement_date: string; source: string; status: string; total: string; lines: number; exceptions: number }>(`
      SELECT cs.id, ca.name AS carrier, cs.period, cs.statement_date, cs.source, cs.status, cs.statement_total::text AS total,
             (SELECT count(*)::int FROM commission_lines cl WHERE cl.statement_id = cs.id) AS lines,
             (SELECT count(*)::int FROM commission_lines cl WHERE cl.statement_id = cs.id AND cl.match_status IN ('unmatched','variance')) AS exceptions
        FROM commission_statements cs JOIN carriers ca ON ca.id = cs.carrier_id ORDER BY cs.status = 'draft' DESC, cs.statement_date DESC, cs.id DESC LIMIT ${at.size} OFFSET ${at.offset}`),
    q<{ id: number; name: string }>("SELECT id, name FROM carriers WHERE bill_modes IN ('direct','both') ORDER BY name"),
    q<{ id: number; policy_number: string; client: string; carrier: string; effective_date: string; premium: string }>(`
      SELECT p.id, p.policy_number, c.name AS client, ca.name AS carrier, p.effective_date, p.premium FROM policies p JOIN clients c ON c.id = p.client_id JOIN carriers ca ON ca.id = p.carrier_id
       WHERE p.bill_mode = 'direct' AND p.effective_date BETWEEN date_trunc('year', current_date - 50) AND current_date - 50 AND p.status IN ('active','expired') AND p.issued_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM commission_lines cl WHERE cl.policy_id = p.id) ORDER BY p.effective_date, p.id`),
  ]);
  const atMissing = paging(sp.page_missing, unpaid.length);
  const missing = pageOf(unpaid, atMissing);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Direct bill commissions" subtitle="Reconcile carrier commission statements against expected commission, then post the deposit." actions={<NotInMvp id="CON-01" label="Statement download (IVANS)" />} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card><Table head={["Carrier", "Period", "Source", { label: "Lines", num: true }, { label: "Exceptions", num: true }, { label: "Total", num: true }, "Status"]} empty="No statements yet.">
            {rows.map((r) => <tr key={r.id}><td className={cls.td}><Link href={`/accounting/commissions/${r.id}`} className={cls.link}>{r.carrier}</Link></td><td className={`${cls.td} text-xs`}>{r.period}</td>
              <td className={cls.td}><Pill tone={r.source === "ai" ? "violet" : "slate"}>{r.source === "ai" ? "Claude (PDF)" : r.source}</Pill></td><td className={cls.num}>{r.lines}</td>
              <td className={`${cls.num} ${r.exceptions ? "font-medium text-amber-700" : "text-slate-400"}`}>{r.exceptions}</td><td className={cls.num}>{money(r.total, true)}</td><td className={cls.td}><Status s={r.status} /></td></tr>)}
          </Table><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Statement pages" /></Card>
          <Card title={`Commission not received (COM-21) · ${atMissing.total}`}>
            <p className="px-4 pt-3 text-xs text-slate-500">Direct-bill policies effective more than 50 days ago that no statement has paid.</p>
            <Table head={["Policy", "Client", "Carrier", "Effective", { label: "Premium", num: true }]} empty="Every direct-bill policy has been paid.">
              {missing.map((m) => <tr key={m.id}><td className={cls.td}><Link href={`/policies/${m.id}`} className="font-mono text-xs text-indigo-700 hover:underline">{m.policy_number}</Link></td><td className={cls.td}>{m.client}</td><td className={`${cls.td} text-xs`}>{m.carrier}</td><td className={`${cls.td} text-xs`}>{m.effective_date}</td><td className={cls.num}>{money(m.premium)}</td></tr>)}
            </Table>
            <Pager at={atMissing} href={(page) => qs(sp, { page_missing: String(page) })} label="Commission not received pages" />
          </Card>
        </div>
        {can(user, "accounting") && <Card title="New statement" pad>
          <form action={newStatementAction} className="space-y-3">
            <Field label="Carrier"><select name="carrier_id" required className={cls.input}>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Statement date"><input type="date" name="statement_date" defaultValue={todayISO()} className={cls.input} /></Field><Field label="Period"><input name="period" placeholder="2026-10" className={cls.input} /></Field></div>
            <Field label="Statement file" hint={`CSV: matched by column names. PDF: ${aiEnabled() ? "Claude reads every line" : "needs ANTHROPIC_API_KEY"}. Leave empty to enter lines by hand.`}><input type="file" name="file" accept=".csv,application/pdf,text/csv" className="text-sm" /></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Deposit amount"><input name="deposit_amount" inputMode="decimal" className={cls.input} /></Field><Field label="Deposit date"><input type="date" name="deposit_date" className={cls.input} /></Field></div>
            <Submit className={cls.btnPrimary} pending="Reading statement…">Load and match</Submit>
          </form>
        </Card>}
      </div>
    </div>
  );
}
