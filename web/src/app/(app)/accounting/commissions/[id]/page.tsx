import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addLineAction, depositAction, lineAction, postStatementAction } from "../../actions";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, KV, PageHeader, Status, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { money, plural, when } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Commission statement" };

export default async function Statement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string; page?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const { id } = await params;
  const sp = await searchParams;
  const user = await currentUser();
  const st = await one<{ id: number; carrier: string; period: string; statement_date: string; source: string; status: string; statement_total: string; deposit_amount: string | null; deposit_date: string | null; posted_at: Date | null }>(
    "SELECT cs.*, ca.name AS carrier FROM commission_statements cs JOIN carriers ca ON ca.id = cs.carrier_id WHERE cs.id = $1", [Number(id)]);
  if (!st) notFound();
  const lines = await q<{ id: number; policy_number: string; insured_name: string | null; transaction_kind: string; premium: string; rate_pct: string | null; commission: string; expected_commission: string | null; match_status: string; note: string | null; policy_id: number | null; client: string | null }>(
    "SELECT cl.*, c.name AS client FROM commission_lines cl LEFT JOIN policies p ON p.id = cl.policy_id LEFT JOIN clients c ON c.id = p.client_id WHERE cl.statement_id = $1 ORDER BY CASE cl.match_status WHEN 'unmatched' THEN 0 WHEN 'variance' THEN 1 ELSE 2 END, cl.id", [st.id]);
  const at = paging(sp.page, lines.length);
  const shown = pageOf(lines, at);
  const total = lines.filter((l) => l.match_status !== "closed").reduce((s, l) => s + Number(l.commission), 0);
  const expected = lines.reduce((s, l) => s + Number(l.expected_commission ?? 0), 0);
  const draft = st.status === "draft" && can(user, "accounting");
  const counts = (s: string) => lines.filter((l) => l.match_status === s).length;
  // The same rules postCommissionStatement enforces, plus variance lines, shown before the click (UX-012).
  const unresolved = counts("unmatched") + counts("variance");
  const deposit = st.deposit_amount == null ? null : Number(st.deposit_amount);
  const depositOk = deposit !== null && Math.abs(deposit - total) <= 0.01;
  const blocked = unresolved ? `Resolve ${plural(unresolved, "line")} to post` : !lines.length ? "Add lines to post" : deposit === null ? "Record deposit to post" : !depositOk ? "Fix the deposit to post" : null;
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/accounting/commissions", label: "Direct bill commissions" }]} title={`${st.carrier} · ${st.period}`} subtitle={<span className="flex items-center gap-2"><Status s={st.status} /> statement {st.statement_date} · loaded by {st.source}</span>} />
      <div className="mb-5 grid gap-3 sm:grid-cols-5">
        {[["Lines", lines.length], ["Matched", counts("matched")], ["Variance", counts("variance")], ["Unmatched", counts("unmatched")], ["Closed", counts("closed")]].map(([l, v]) => <div key={l as string} className="rounded-lg border border-slate-200 bg-white px-4 py-3"><div className="text-xs text-slate-500">{l}</div><div className={`text-xl font-semibold tabular-nums ${l === "Unmatched" && v ? "text-rose-600" : l === "Variance" && v ? "text-amber-600" : ""}`}>{v}</div></div>)}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="overflow-x-auto"><table className="w-full min-w-[820px]">
            <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{["Policy", "Insured", "Type", "Premium", "Rate", "Paid", "Expected", "Status", ""].map((h) => <th key={h} className={["Premium", "Rate", "Paid", "Expected"].includes(h) ? `${cls.th} text-right` : cls.th}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{shown.map((l) => <tr key={l.id} className={l.match_status === "unmatched" ? "bg-rose-50/40" : l.match_status === "variance" ? "bg-amber-50/40" : ""}>
              <td className={cls.td}>{l.policy_id ? <Link href={`/policies/${l.policy_id}`} className="font-mono text-xs text-indigo-700 hover:underline">{l.policy_number}</Link> : <span className="font-mono text-xs">{l.policy_number}</span>}</td>
              <td className={`${cls.td} text-xs`}>{l.client ?? l.insured_name}{l.note && <div className="text-[11px] text-slate-400">{l.note}</div>}</td><td className={`${cls.td} text-xs`}>{l.transaction_kind}</td>
              <td className={`${cls.num} text-xs`}>{money(l.premium, true)}</td><td className={`${cls.num} text-xs`}>{l.rate_pct ? `${Number(l.rate_pct)}%` : "—"}</td>
              <td className={cls.num}>{money(l.commission, true)}</td><td className={`${cls.num} text-xs`}>{l.expected_commission ? money(l.expected_commission, true) : "—"}</td>
              <td className={cls.td}><Status s={l.match_status} /></td>
              <td className={`${cls.td} text-right`}>{draft && l.match_status !== "matched" && l.match_status !== "closed" && <details><summary className="text-xs text-indigo-600">Resolve</summary>
                <div className="mt-1 w-56 space-y-1 text-left">
                  {l.match_status === "variance" && <form action={lineAction}><input type="hidden" name="id" value={st.id} /><input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="op" value="accept" /><Submit className={`${cls.btnSm} w-full`}>Accept carrier amount</Submit></form>}
                  <form action={lineAction} className="flex gap-1"><input type="hidden" name="id" value={st.id} /><input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="op" value="match" /><input name="policy_number" placeholder="Policy #" className="w-full rounded border border-slate-300 px-1 text-xs" /><Submit className={cls.btnSm}>Match</Submit></form>
                  <form action={lineAction} className="flex gap-1"><input type="hidden" name="id" value={st.id} /><input type="hidden" name="line_id" value={l.id} /><input type="hidden" name="op" value="close" /><input name="note" placeholder="Why" className="w-full rounded border border-slate-300 px-1 text-xs" /><Submit className={cls.btnSm}>Close</Submit></form>
                </div></details>}</td>
            </tr>)}</tbody>
          </table></div>
        <Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Statement line pages" /></Card>
        <div className="space-y-5">
          <Card title="Balance" pad><KV cols={1} items={[["Lines (excluding closed)", money(total, true)], ["Expected from agreements", money(expected, true)], ["Difference", money(total - expected, true)], ["Deposit", st.deposit_amount ? `${money(st.deposit_amount, true)} on ${st.deposit_date}` : "—"], ...(st.posted_at ? [["Posted", when(st.posted_at)] as [string, string]] : [])]} /></Card>
          {draft && <>
            <Card title="Post statement" pad>
              <form action={depositAction} className="mb-3 space-y-2"><input type="hidden" name="id" value={st.id} />
                <div className="grid grid-cols-2 gap-2"><Field label="Carrier's deposit"><input name="deposit_amount" defaultValue={st.deposit_amount ?? ""} required className={cls.input} /></Field><Field label="Date"><input type="date" name="deposit_date" defaultValue={st.deposit_date ?? st.statement_date} className={cls.input} /></Field></div>
                <Submit className={`${cls.btnSm} w-full`}>{st.deposit_amount == null ? "Record the deposit" : "Correct the deposit"}</Submit>
              </form>
              <form action={postStatementAction} className="space-y-2"><input type="hidden" name="id" value={st.id} />
                {st.deposit_amount && Math.abs(Number(st.deposit_amount) - total) > 0.01 && <p className="rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">The carrier deposited {money(st.deposit_amount, true)}; reconciled lines total {money(total, true)}. The {money(Number(st.deposit_amount) - total, true)} on closed lines isn&apos;t agency income: return it to the carrier or match it before posting it.</p>}
                <div className="text-xs font-medium text-slate-600">Ready to post?</div>
                <ul className="space-y-0.5 text-xs">
                  {([[!counts("unmatched"), counts("unmatched") ? `${plural(counts("unmatched"), "line")} unmatched` : "No lines unmatched"], [!counts("variance"), counts("variance") ? `${plural(counts("variance"), "line")} with variance` : "No lines with variance"],
                    [deposit !== null, deposit === null ? "No deposit recorded" : `Deposit recorded: ${money(deposit, true)}`], [depositOk, `Deposit ${depositOk ? "equals" : "doesn't equal"} lines ${money(total, true)}`]] as [boolean, string][]).map(([ok, text]) => <li key={text} className={ok ? "text-emerald-700" : "text-rose-700"}>{ok ? "✔" : "✖"} {text}</li>)}
                </ul>
                {blocked ? <button type="button" disabled className={`${cls.btnGreen} w-full`}>{blocked}</button> : <Submit className={`${cls.btnGreen} w-full`} confirm={`Post ${money(total, true)} to commission income for ${st.carrier}, ${st.period}? Posted statements can't be edited.`}>Post to commission income</Submit>}
              </form>
              <form action={lineAction} className="mt-2"><input type="hidden" name="id" value={st.id} /><input type="hidden" name="line_id" value="0" /><input type="hidden" name="op" value="rematch" /><Submit className={`${cls.btnSm} w-full`}>Re-run matching</Submit></form>
            </Card>
            <Card title="Add a line" pad>
              <form action={addLineAction} className="grid grid-cols-2 gap-2"><input type="hidden" name="id" value={st.id} />
                <Field label="Policy #" className="col-span-2"><input name="policy_number" required className={cls.input} /></Field>
                <Field label="Premium"><input name="premium" className={cls.input} /></Field><Field label="Commission"><input name="commission" required className={cls.input} /></Field>
                <Field label="Rate %"><input name="rate_pct" className={cls.input} /></Field><Field label="Type"><select name="transaction_kind" className={cls.input}><option>new</option><option>renewal</option><option>endorsement</option><option>cancellation</option></select></Field>
                <Submit className={`${cls.btn} col-span-2`}>Add</Submit>
              </form>
            </Card>
          </>}
        </div>
      </div>
    </div>
  );
}
