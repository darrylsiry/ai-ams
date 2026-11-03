import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import Link from "next/link";
import { reverseReceiptAction } from "../actions";
import { Submit } from "@/components/submit";
import { Card, Flash, PageHeader, Status, Table, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { money } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Receipts" };

export default async function Receipts({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; page?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const user = await currentUser();
  const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM receipts");
  const at = paging(sp.page, count!.n);
  const rows = await q<{ id: number; receipt_number: string; client_id: number | null; client: string | null; received_date: string; amount: string; method: string; reference: string | null; status: string; applied: string; by: string | null }>(`
    SELECT r.id, r.receipt_number, r.client_id, c.name AS client, r.received_date, r.amount, r.method, r.reference, r.status, u.full_name AS by,
           coalesce((SELECT sum(amount) FROM receipt_applications WHERE receipt_id = r.id),0)::text AS applied
      FROM receipts r LEFT JOIN clients c ON c.id = r.client_id LEFT JOIN users u ON u.id = r.created_by_id ORDER BY r.received_date DESC, r.id DESC LIMIT ${at.size} OFFSET ${at.offset}`);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Receipts" subtitle="Client payments deposited to the premium trust account" actions={can(user, "accounting") && <Link href="/accounting/receipts/new" className={cls.btnPrimary}>＋ Record payment</Link>} />
      <Card><Table head={["Receipt", "Client", "Date", { label: "Amount", num: true }, { label: "Applied", num: true }, "Method", "Status", ""]} empty="No receipts.">
        {rows.map((r) => <tr key={r.id}><td className={`${cls.td} font-mono text-xs`}>{r.receipt_number}</td><td className={cls.td}>{r.client_id ? <Link href={`/clients/${r.client_id}?tab=billing`} className="hover:underline">{r.client}</Link> : "—"}</td>
          <td className={`${cls.td} text-xs`}>{r.received_date}</td><td className={cls.num}>{money(r.amount, true)}</td><td className={`${cls.num} text-xs`}>{money(r.applied, true)}</td>
          <td className={`${cls.td} text-xs`}>{r.method}{r.reference ? ` #${r.reference}` : ""}</td><td className={cls.td}><Status s={r.status} /></td>
          <td className={`${cls.td} text-right`}>{r.status === "finalized" && can(user, "accounting") && <details><summary className="text-xs text-rose-600">{Number(r.amount) < 0 ? "Void refund" : r.method === "credit" ? "Undo credit" : "NSF / reverse"}</summary>
            <form action={reverseReceiptAction} className="mt-1 flex gap-1"><input type="hidden" name="id" value={r.id} /><input name="reason" defaultValue={Number(r.amount) < 0 ? "Refund check voided" : r.method === "credit" ? "Applied in error" : "NSF — returned by bank"} className="rounded border border-slate-300 px-1 text-xs" />{Number(r.amount) < 0 ? <Submit className={cls.btnSm} confirm={`Void refund ${r.receipt_number} (${money(-Number(r.amount), true)}) to ${r.client ?? "the client"}? The credit opens again and the money goes back into trust.`}>Void</Submit> : <Submit className={cls.btnSm} confirm={r.method === "credit" ? `Undo credit ${r.receipt_number} (${money(r.amount, true)}) for ${r.client ?? "the client"}? The credit and its invoice both go back.` : `Reverse receipt ${r.receipt_number} (${money(r.amount, true)}) from ${r.client ?? "the client"}? Its invoices reopen.`}>Reverse</Submit>}</form></details>}</td></tr>)}
      </Table><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Receipt pages" /></Card>
    </div>
  );
}
