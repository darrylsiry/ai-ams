import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { ClientPicker } from "@/components/client-picker";
import { denied } from "@/components/gate";
import Link from "next/link";
import { invoiceAction, refundAction } from "../actions";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, PageHeader, Status, Table, Tabs, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { money, refundConfirm, todayISO } from "@/lib/format";
import { can, currentUser } from "@/lib/user";
import { qs } from "@/lib/url";

export const metadata = { title: "Invoices" };

export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const user = await currentUser();
  const status = sp.status ?? "open";
  const today = todayISO();
  const where = status === "refunds" ? "i.status = 'open' AND i.total < 0" : status === "open" ? "i.status IN ('open','partial') AND i.total > 0" : status === "pastdue" ? `i.status IN ('open','partial') AND i.total > 0 AND i.due_date < '${today}'` : status === "all" ? "true" : `i.status = '${status === "paid" ? "paid" : "void"}'`;
  const count = await one<{ n: number }>(`SELECT count(*)::int AS n FROM invoices i WHERE ${where}`);
  const at = paging(sp.page, count!.n);
  const rows = await q<{ id: number; invoice_number: string; client_id: number; client: string; policy_number: string | null; issue_date: string; due_date: string; total: string; paid: string; status: string; memo: string | null }>(`
    SELECT i.id, i.invoice_number, i.client_id, c.name AS client, p.policy_number, i.issue_date, i.due_date, i.total, i.status, i.memo,
           coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'),0)::text AS paid
      FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN policies p ON p.id = i.policy_id WHERE ${where} ORDER BY i.due_date DESC, i.id DESC LIMIT ${at.size} OFFSET ${at.offset}`);
  // What each client with a credit on this page still owes, for the refund question and its confirmation (CR-053).
  const creditClients = [...new Set(rows.filter((r) => r.status === "open" && Number(r.total) < 0).map((r) => r.client_id))];
  const owed = new Map((creditClients.length ? await q<{ client_id: number; owed: string }>(`
    SELECT i.client_id, round(sum(i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'),0)), 2)::text AS owed
      FROM invoices i WHERE i.client_id = ANY($1) AND i.status IN ('open','partial') AND i.total > 0 GROUP BY i.client_id`, [creditClients]) : []).map((o) => [o.client_id, Number(o.owed)]));
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Invoices &amp; aging" subtitle="Agency-bill invoices. Premium invoices are created automatically from policy transactions." />
      <Tabs current={status} tabs={[["open", "Open"], ["pastdue", "Past due"], ["refunds", "Refunds due"], ["paid", "Paid"], ["all", "All"]].map(([k, l]) => ({ key: k, label: l, href: qs(sp, { status: k, page: undefined }) }))} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className={can(user, "accounting") ? "lg:col-span-2" : "lg:col-span-3"}><Table head={["Invoice", "Client", "Policy", "Due", { label: "Total", num: true }, { label: "Balance", num: true }, "Status", ""]} empty="No invoices.">
          {rows.map((r) => { const bal = Number(r.total) - Number(r.paid); return <tr key={r.id}><td className={cls.td}><span className="font-mono text-xs">{r.invoice_number}</span><div className="text-[11px] text-slate-400">{r.memo}</div></td>
            <td className={cls.td}><Link href={`/clients/${r.client_id}?tab=billing`} className="hover:underline">{r.client}</Link></td><td className={`${cls.td} font-mono text-xs`}>{r.policy_number ?? "—"}</td>
            <td className={`${cls.td} text-xs ${bal > 0 && r.due_date < today ? "font-medium text-rose-600" : ""}`}>{r.due_date}</td><td className={cls.num}>{money(r.total, true)}</td><td className={cls.num}>{money(bal, true)}</td>
            <td className={cls.td}><Status s={r.status} /></td><td className={`${cls.td} text-right`}>{bal < 0 && r.status === "open" && can(user, "accounting") ? <form action={refundAction} className="flex justify-end gap-1"><input type="hidden" name="invoice_id" value={r.id} />{(owed.get(r.client_id) ?? 0) > 0 && <input type="hidden" name="owed_ack" value={owed.get(r.client_id)!.toFixed(2)} />}<input name="reference" placeholder="Check #" className="w-20 rounded border border-slate-300 px-1 text-xs" /><Submit className={cls.btnSm} confirm={refundConfirm(-bal, r.client, owed.get(r.client_id))}>Refund</Submit></form> : <a href={`/documents/render?kind=invoice&invoice=${r.id}`} className={cls.btnSm}>PDF</a>}</td></tr>; })}
        </Table><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Invoice pages" /></Card>
        {can(user, "accounting") && <Card title="Fee invoice" pad>
          <form action={invoiceAction} className="space-y-3">
            <Field label="Client"><ClientPicker name="client_id" required scope="insured" /></Field>
            <Field label="Kind"><select name="kind" className={cls.input}><option value="agency_fee">Agency / service fee</option><option value="broker_fee">Broker fee (needs signed disclosure)</option><option value="policy_fee">Carrier policy fee</option></select></Field>
            <Field label="Description"><input name="description" defaultValue="Agency service fee" className={cls.input} /></Field>
            <Field label="Amount"><input name="amount" inputMode="decimal" required className={cls.input} /></Field>
            <Submit className={cls.btnPrimary}>Create invoice</Submit>
          </form>
        </Card>}
      </div>
    </div>
  );
}
