import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import { qs } from "@/lib/url";
import { denied } from "@/components/gate";
import { lockPeriodAction, markExportedAction } from "../actions";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { Card, Flash, PageHeader, Pill, Table, cls } from "@/components/ui";
import { ACCOUNT_LABEL, type Account } from "@/lib/accounting";
import { one, q } from "@/lib/db";
import { money, todayISO } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Ledger & export" };

/** Debits against credits for a month (UX-016). */
function BalanceMark({ off }: { off: number }) {
  return Math.abs(off) < 0.005 ? <span className="whitespace-nowrap font-medium text-emerald-700">✔ Balanced</span> : <span className="whitespace-nowrap font-medium text-rose-600">✖ Out of balance by {money(Math.abs(off), true)}</span>;
}

export default async function Ledger({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; month?: string; page?: string }> }) {
  const deny = await denied("accounting.view", "Accounting", "accounting, principal, administrator or account manager");
  if (deny) return deny;
  const sp = await searchParams;
  const user = await currentUser();
  const month = sp.month ?? todayISO().slice(0, 7);
  const count = await one<{ n: number }>("SELECT count(DISTINCT journal)::int AS n FROM ledger_entries WHERE to_char(entry_date, 'YYYY-MM') = $1", [month]);
  const at = paging(sp.page, count!.n);
  const [summary, periods, journals] = await Promise.all([
    q<{ account: Account; debit: string; credit: string }>("SELECT account, sum(debit)::text AS debit, sum(credit)::text AS credit FROM ledger_entries WHERE to_char(entry_date, 'YYYY-MM') = $1 GROUP BY account ORDER BY account", [month]),
    q<{ period: string; locked: boolean; locked_by: string | null; entries: number; off: string }>(`SELECT m.period, coalesce(ap.locked, false) AS locked, ap.locked_by, (SELECT count(*)::int FROM ledger_entries le WHERE to_char(le.entry_date, 'YYYY-MM') = m.period) AS entries,
        (SELECT coalesce(sum(le.debit - le.credit),0)::text FROM ledger_entries le WHERE to_char(le.entry_date, 'YYYY-MM') = m.period) AS off
      FROM (SELECT to_char(generate_series(date_trunc('month', current_date) - interval '23 months', current_date, '1 month'), 'YYYY-MM') AS period) m LEFT JOIN accounting_periods ap ON ap.period = m.period ORDER BY m.period DESC`),
    q<{ journal: string; entry_date: string; memo: string; amount: string; lines: number }>("SELECT journal, min(entry_date) AS entry_date, min(memo) AS memo, sum(debit)::text AS amount, count(*)::int AS lines FROM ledger_entries WHERE to_char(entry_date, 'YYYY-MM') = $1 GROUP BY journal ORDER BY min(entry_date) DESC, journal LIMIT $2 OFFSET $3", [month, at.size, at.offset]),
  ]);
  const debits = summary.reduce((s, x) => s + Number(x.debit), 0), credits = summary.reduce((s, x) => s + Number(x.credit), 0);
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader title="Ledger &amp; export" subtitle="Every posting is a balanced journal. Export to your general ledger (QuickBooks or CSV) monthly; lock the month after."
        actions={<>{can(user, "accounting") && <form action={markExportedAction}><input type="hidden" name="month" value={month} /><Submit className={cls.btn} confirm={`Mark ${month} as exported? Entries already sent can't be stamped again.`}>Mark as exported</Submit></form>}<a href={`/accounting/export?kind=summary&month=${month}`} className={cls.btn}>Summary journal (CSV)</a><a href={`/accounting/export?kind=detail&month=${month}`} className={cls.btn}>Detail (CSV)</a><a href={`/accounting/export?kind=iif&month=${month}`} className={cls.btnPrimary}>QuickBooks IIF</a></>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <form className="flex items-end gap-2"><label className="text-sm text-slate-600">Month <input name="month" type="month" defaultValue={month} className={`${cls.inputInline} w-auto`} /></label><button className={cls.btn}>Show</button></form>
          <Card title={`Summary · ${month}`}><Table head={["Account", { label: "Debits", num: true }, { label: "Credits", num: true }, { label: "Net", num: true }]} empty="No postings this month.">{summary.map((s) => <tr key={s.account}><td className={cls.td}>{ACCOUNT_LABEL[s.account]}</td><td className={cls.num}>{money(s.debit, true)}</td><td className={cls.num}>{money(s.credit, true)}</td><td className={cls.num}>{money(Number(s.debit) - Number(s.credit), true)}</td></tr>)}{summary.length > 0 && <tr className="bg-slate-50/60 font-medium"><td className={cls.td}>Total</td><td className={cls.num}>{money(debits, true)}</td><td className={cls.num}>{money(credits, true)}</td><td className={cls.num}><BalanceMark off={debits - credits} /></td></tr>}</Table></Card>
          <Card title="Journals"><Table head={["Date", "Journal", "Memo", { label: "Amount", num: true }]}>{journals.map((j) => <tr key={j.journal}><td className={`${cls.td} text-xs`}>{j.entry_date}</td><td className={`${cls.td} font-mono text-[11px] text-slate-500`}>{j.journal}</td><td className={`${cls.td} text-xs`}>{j.memo}</td><td className={`${cls.num} text-xs`}>{money(j.amount, true)}</td></tr>)}</Table><Pager at={at} href={(page) => qs(sp, { page: String(page) })} label="Journal pages" /></Card>
        </div>
        <div className="space-y-5">
          <Card title="Accounting periods"><Table head={["Month", { label: "Entries", num: true }, "Status", ""]}>{periods.map((p) => <tr key={p.period}><td className={`${cls.td} text-xs`}>{p.period}</td><td className={`${cls.num} text-xs`}>{p.entries}</td><td className={cls.td}>{p.locked ? <Pill tone="slate">locked</Pill> : <Pill tone="green">open</Pill>}</td>
            <td className={cls.td}><div className="flex items-center justify-end gap-2 text-xs">{p.entries > 0 && <BalanceMark off={Number(p.off)} />}{can(user, "accounting") && <form action={lockPeriodAction}><input type="hidden" name="period" value={p.period} /><input type="hidden" name="lock" value={p.locked ? "0" : "1"} /><Submit className={cls.btnSm} confirm={p.locked ? `Unlock ${p.period}? Postings into a closed month change exported totals.` : `Lock ${p.period}? Nothing can post into it until it is unlocked.`}>{p.locked ? "Unlock" : "Lock"}</Submit></form>}</div></td></tr>)}</Table></Card>
          <Card pad><div className="flex flex-wrap gap-2"><NotInMvp id="GL-12" /><NotInMvp id="GL-19" /></div></Card>
        </div>
      </div>
    </div>
  );
}
