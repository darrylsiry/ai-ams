import { ClientPicker } from "@/components/client-picker";
import { pickedClient } from "@/lib/client-search";
import Link from "next/link";
import { denied } from "@/components/gate";
import { receiptAction } from "../../actions";
import { NotInMvp } from "@/components/not-mvp";
import { PostReceiptButton, UseFullBalance } from "@/components/money-confirm";
import { Card, Field, Flash, NoAccess, PageHeader, Table, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { money, todayISO } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Record payment" };

export default async function NewReceipt({ searchParams }: { searchParams: Promise<{ client?: string; error?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  if (!can(await currentUser(), "accounting")) return <NoAccess what="payment entry" roles="accounting, principal or administrator" />;
  const sp = await searchParams;
  const clientId = Number(sp.client) || null;
  const picked = await pickedClient(clientId);
  const invoices = clientId ? await q<{ id: number; invoice_number: string; due_date: string; total: string; bal: string; memo: string | null }>(`SELECT i.id, i.invoice_number, i.due_date, i.total, i.memo,
    (i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'),0))::text AS bal
    FROM invoices i WHERE i.client_id = $1 AND i.status IN ('open','partial') AND i.total > 0 ORDER BY i.due_date, i.id`, [clientId]) : [];
  const open = invoices.map((i) => ({ id: i.id, number: i.invoice_number, balance: Number(i.bal) }));
  const openBalance = open.reduce((s, i) => s + i.balance, 0);
  // Credits aren't paid by a receipt, and netting them into its amount would leave both open (CR-037).
  const credit = clientId ? await one<{ v: string | null }>(`SELECT sum(-(i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'),0)))::text AS v
    FROM invoices i WHERE i.client_id = $1 AND i.status = 'open' AND i.total < 0`, [clientId]) : null;
  return (
    <div className="max-w-4xl">
      <Flash error={sp.error} />
      <PageHeader crumbs={[{ href: "/accounting/receipts", label: "Receipts" }]} title="Record payment" subtitle="Deposited to the premium trust account and applied to invoices (oldest first unless you pick)." actions={<NotInMvp id="CSH-09" label="Online payment" />} />
      <form className="mb-4 flex items-end gap-2"><Field label="Client with an open balance" className="flex-1"><ClientPicker key={clientId ?? "none"} name="client" required scope="open_balance" initial={picked} loads="new-receipt" /></Field><button className={cls.btn}>Load invoices</button></form>
      {clientId && Number(credit?.v) > 0 && <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">This client has {money(credit!.v!)} of credit. <Link href={`/clients/${clientId}?tab=billing`} className={cls.link}>Apply it on the billing tab</Link> before recording a payment.</p>}
      {clientId && <form id="new-receipt" action={receiptAction} className="space-y-5"><input type="hidden" name="client_id" value={clientId} />
        <Card title="Open invoices"><Table head={["", "Invoice", "Due", { label: "Total", num: true }, { label: "Balance", num: true }]} empty="No open invoices.">{invoices.map((i) => <tr key={i.id}><td className="w-8 px-3"><input type="checkbox" name="invoice_ids" value={i.id} /></td><td className={cls.td}><span className="font-mono text-xs">{i.invoice_number}</span><div className="text-xs text-slate-400">{i.memo}</div></td><td className={`${cls.td} text-xs`}>{i.due_date}</td><td className={cls.num}>{money(i.total, true)}</td><td className={`${cls.num} font-medium`}>{money(i.bal, true)}</td></tr>)}</Table></Card>
        <Card title="Payment" pad><div className="grid gap-4 sm:grid-cols-4">
          <div><Field label="Amount"><input name="amount" required inputMode="decimal" className={cls.input} /></Field>{openBalance > 0 && <p className="mt-1 text-[11px] text-slate-500">Open balance {money(openBalance, true)} · <UseFullBalance invoices={open} /></p>}</div>
          <Field label="Method"><select name="method" className={cls.input}><option value="check">Check</option><option value="ach">ACH</option><option value="card">Card</option><option value="wire">Wire</option><option value="cash">Cash</option></select></Field>
          <Field label="Check / reference #"><input name="reference" className={cls.input} /></Field>
          <Field label="Date received"><input type="date" name="date" defaultValue={todayISO()} className={cls.input} /></Field>
          <Field label="Memo" className="sm:col-span-4"><input name="memo" className={cls.input} /></Field>
        </div></Card>
        <PostReceiptButton className={cls.btnPrimary} client={picked?.name ?? "this client"} invoices={open} />
      </form>}
    </div>
  );
}
