import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import { payCarrierAction, recordCarrierReturnAction } from "../actions";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { Card, Flash, PageHeader, Table, cls } from "@/components/ui";
import { carrierPayables } from "@/lib/accounting";
import { one, q } from "@/lib/db";
import { money, plural } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Carrier payables" };

export default async function Payables({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; page?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const user = await currentUser();
  const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM carrier_statements");
  const at = paging(sp.page, count!.n);
  const [owed, history] = await Promise.all([carrierPayables(),
    q<{ id: number; carrier: string; statement_date: string; total: string; reference: string | null; items: number }>("SELECT cs.id, ca.name AS carrier, cs.statement_date, cs.total::text, cs.reference, (SELECT count(*)::int FROM invoice_lines il WHERE il.carrier_statement_id = cs.id) AS items FROM carrier_statements cs JOIN carriers ca ON ca.id = cs.carrier_id ORDER BY cs.statement_date DESC, cs.id DESC LIMIT $1 OFFSET $2", [at.size, at.offset])]);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Carrier payables" subtitle="Net premium owed to carriers and wholesalers on collected agency-bill invoices (pay by statement)." actions={<NotInMvp id="GL-03" />} />
      <Card title="Owed now" className="mb-5"><Table head={["Payee", { label: "Items", num: true }, "Oldest invoice", { label: "Net owed", num: true }, ""]} empty="Nothing collected is waiting to be paid.">
        {owed.map((o) => <tr key={o.carrier_id}><td className={cls.td}>{o.carrier}</td><td className={cls.num}>{o.lines}</td><td className={`${cls.td} text-xs`}>{o.oldest}</td><td className={`${cls.num} font-medium`}>{money(o.owed, true)}</td>
          <td className={`${cls.td} text-right`}>{can(user, "accounting") && (Number(o.owed) < 0 ? <form action={recordCarrierReturnAction} className="flex justify-end gap-1"><input type="hidden" name="carrier_id" value={o.carrier_id} /><input name="reference" required placeholder="Deposit reference" aria-label={`Deposit reference for ${o.carrier}`} className="w-32 rounded border border-slate-300 px-2 py-1 text-xs" /><Submit className={cls.btnSm} confirm={`Record ${money(-Number(o.owed), true)} received from ${o.carrier} into trust?`}>Record return</Submit></form> : <form action={payCarrierAction} className="flex justify-end gap-1"><input type="hidden" name="carrier_id" value={o.carrier_id} /><input name="reference" placeholder="ACH / check #" className="w-32 rounded border border-slate-300 px-2 py-1 text-xs" /><Submit className={cls.btnSm} confirm={`Pay ${o.carrier} ${money(o.owed, true)} from trust (${plural(o.lines, "item")})?`}>Pay statement</Submit></form>)}</td></tr>)}
      </Table></Card>
      <Card title="Paid statements"><Table head={["Payee", "Paid", { label: "Items", num: true }, { label: "Total", num: true }, "Reference"]} empty="None yet.">
        {history.map((h) => <tr key={h.id}><td className={cls.td}>{h.carrier}</td><td className={`${cls.td} text-xs`}>{h.statement_date}</td><td className={cls.num}>{h.items}</td><td className={cls.num}>{money(h.total, true)}</td><td className={`${cls.td} text-xs`}>{h.reference}</td></tr>)}
      </Table><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Paid statement pages" /></Card>
    </div>
  );
}
