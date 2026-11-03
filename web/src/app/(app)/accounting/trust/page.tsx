import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import { sweepAction } from "../actions";
import { SweepButton } from "@/components/money-confirm";
import { Card, Field, Flash, KV, PageHeader, Table, cls } from "@/components/ui";
import { ACCOUNT_LABEL, balances, sweepable, type Account } from "@/lib/accounting";
import { one, q } from "@/lib/db";
import { money, todayISO } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Trust account" };

export default async function Trust({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; page?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const user = await currentUser();
  const count = await one<{ n: number }>("SELECT count(*)::int AS n FROM ledger_entries WHERE account = 'trust_cash'");
  const at = paging(sp.page, count!.n);
  const [b, s, moves] = await Promise.all([balances(), sweepable(), q<{ entry_date: string; memo: string; debit: string; credit: string }>("SELECT entry_date, memo, debit, credit FROM ledger_entries WHERE account = 'trust_cash' ORDER BY entry_date DESC, id DESC LIMIT $1 OFFSET $2", [at.size, at.offset])]);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Premium trust account" subtitle={`Statement of premium trust as of ${todayISO()} (GL-23..25). Premium collected from insureds is fiduciary money: only earned commission may leave.`} actions={<a href="/accounting/export?kind=trust" className={cls.btn}>Download statement (CSV)</a>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Statement of premium trust" pad className="lg:col-span-2">
          <KV cols={2} items={[["Trust cash", money(s.trust, true)], ["Owed to carriers and wholesalers, on collected premium", money(s.carriers, true)], ["Owed to states (surplus lines tax), on collected premium", money(s.taxes, true)], ["Client refunds owed", money(s.credits, true)], ["Carrier and tax share not yet collected (not counted)", money(s.uncollected, true)],
            ["Fiduciary obligations on collected premium", money(s.owed, true)], ["Excess (earned commission available to sweep)", <span key="x" className={s.available > 0 ? "font-semibold text-emerald-700" : ""}>{money(s.available, true)}</span>]]} />
          {s.trust < s.owed && <p className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">Shortfall of {money(s.owed - s.trust, true)}: trust cash doesn&apos;t cover obligations.</p>}
        </Card>
        {can(user, "accounting") && <Card title="Sweep earned commission" pad><form action={sweepAction} className="space-y-2"><Field label="Amount to operating"><input name="amount" defaultValue={s.available.toFixed(2)} className={cls.input} /></Field><SweepButton className={cls.btnPrimary} /><p className="text-[11px] text-slate-500">The system refuses any sweep larger than the excess.</p></form></Card>}
        <Card title="Sub-ledger balances" className="lg:col-span-1"><Table head={["Account", { label: "Balance", num: true }]}>{(Object.keys(ACCOUNT_LABEL) as Account[]).map((a) => <tr key={a}><td className={`${cls.td} text-xs`}>{ACCOUNT_LABEL[a]}</td><td className={`${cls.num} text-xs`}>{money(b[a], true)}</td></tr>)}</Table></Card>
        <Card title="Trust activity" className="lg:col-span-2"><Table head={["Date", "Memo", { label: "In", num: true }, { label: "Out", num: true }]}>{moves.map((m, i) => <tr key={i}><td className={`${cls.td} text-xs`}>{m.entry_date}</td><td className={`${cls.td} text-xs`}>{m.memo}</td><td className={`${cls.num} text-xs text-emerald-700`}>{Number(m.debit) ? money(m.debit, true) : ""}</td><td className={`${cls.num} text-xs`}>{Number(m.credit) ? money(m.credit, true) : ""}</td></tr>)}</Table><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Trust activity pages" /></Card>
      </div>
    </div>
  );
}
