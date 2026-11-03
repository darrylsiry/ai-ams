import { Pager } from "@/components/pager";
import { pageOf, paging } from "@/lib/paging";
import Link from "next/link";
import { NotInMvp } from "@/components/not-mvp";
import { Card, PageHeader, Pill, Stat, Tabs, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { daysBetween, money, todayISO } from "@/lib/format";
import { OPP_STAGE_LABEL } from "@/lib/ref";
import { currentUser } from "@/lib/user";
import { qs } from "@/lib/url";

export const metadata = { title: "Sales pipeline" };

type Row = { id: number; name: string; stage: string; est_premium: string | null; target_date: string | null; client_id: number; client_name: string; owner: string | null; subs: number; quoted: number; created_at: Date };

export default async function Sales({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const view = sp.view ?? (user.role === "producer" ? "mine" : "all");
  const params: unknown[] = [];
  let filter = "";
  if (view === "mine") { params.push(user.id); filter = `AND o.owner_id = $1`; }
  const rows = await q<Row>(`SELECT o.id, o.name, o.stage, o.est_premium, o.target_date, o.client_id, c.name AS client_name, u.full_name AS owner, o.created_at,
      (SELECT count(*)::int FROM submissions s WHERE s.opportunity_id = o.id) AS subs, (SELECT count(*)::int FROM submissions s WHERE s.opportunity_id = o.id AND s.status = 'quoted') AS quoted
    FROM opportunities o JOIN clients c ON c.id = o.client_id LEFT JOIN users u ON u.id = o.owner_id WHERE o.stage NOT IN ('won','lost') ${filter} ORDER BY o.target_date NULLS LAST, o.id`, params);
  const won = await one<{ n: number; premium: string; lost: number }>(`SELECT count(*) FILTER (WHERE stage = 'won')::int AS n, coalesce(sum(est_premium) FILTER (WHERE stage = 'won'),0)::text AS premium,
      count(*) FILTER (WHERE stage = 'lost')::int AS lost FROM opportunities o WHERE closed_at >= date_trunc('year', now()) ${filter}`, params);
  const today = todayISO();
  const stages = ["lead", "qualifying", "submitted", "quoted", "proposal"];
  const firstPages = Object.fromEntries(stages.map((s) => [`page_${s}`, undefined]));
  const hit = won!.n + won!.lost ? (won!.n / (won!.n + won!.lost)) * 100 : 0;
  return (
    <div>
      <PageHeader title="Sales pipeline" subtitle={`${rows.length} open opportunities · ${money(rows.reduce((s, r) => s + Number(r.est_premium ?? 0), 0))} estimated premium`}
        actions={<><NotInMvp id="PLC-18" /><NotInMvp id="SAL-19" /><Link href="/sales/new" className={cls.btnPrimary}>＋ Opportunity</Link></>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Won this year" value={won!.n} sub={money(won!.premium)} tone="green" />
        <Stat label="Lost this year" value={won!.lost} />
        <Stat label="Hit ratio" value={`${hit.toFixed(0)}%`} sub="won ÷ (won + lost)" />
        <Stat label="Quotes in hand" value={rows.filter((r) => r.quoted > 0).length} sub="opportunities with a quote" tone="indigo" />
      </div>
      <Tabs current={view} tabs={[{ key: "mine", label: "My pipeline", href: qs(sp, { ...firstPages, view: "mine" }) }, { key: "all", label: "Everyone", href: qs(sp, { ...firstPages, view: "all" }) }]} />
      <div className="grid gap-3 lg:grid-cols-5">
        {stages.map((s) => {
          const col = rows.filter((r) => r.stage === s);
          const param = `page_${s}`;
          const at = paging(sp[param], col.length, 25);
          return (
            <div key={s} className="rounded-lg bg-slate-100/80 p-2">
              <div className="mb-2 flex justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-600"><span>{OPP_STAGE_LABEL[s]}</span><span className="tabular-nums text-slate-500">{col.length}</span></div>
              <div className="space-y-2">
                {pageOf(col, at).map((r) => {
                  const d = r.target_date ? daysBetween(today, r.target_date) : null;
                  return <Link key={r.id} href={`/sales/${r.id}`} className="block rounded-md border border-slate-200 bg-white p-2.5 shadow-sm hover:border-indigo-300">
                    <div className="truncate text-sm font-medium text-slate-900">{r.client_name}</div>
                    <div className="truncate text-xs text-slate-500">{r.name.replace(`${r.client_name} — `, "")}</div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500"><span>{r.est_premium ? money(r.est_premium) : "—"} · {r.owner?.split(" ")[0]}</span>
                      {r.subs > 0 && <Pill tone={r.quoted ? "blue" : "slate"}>{r.quoted}/{r.subs} quoted</Pill>}</div>
                    {d !== null && <div className={`mt-1 text-[11px] ${d < 0 ? "text-rose-600" : "text-slate-400"}`}>target {r.target_date}</div>}
                  </Link>;
                })}
                {col.length === 0 && <div className="rounded-md border border-dashed border-slate-300 py-4 text-center text-xs text-slate-400">None</div>}
              </div>
              <Pager compact at={at} href={(page) => qs(sp, { [param]: String(page) })} label={`${OPP_STAGE_LABEL[s]} pages`} />
            </div>
          );
        })}
      </div>
      <Card className="mt-5" pad><p className="text-xs text-slate-500">Bind a quoted submission to create the policy (the opportunity is marked won and the prospect becomes an insured). Rating and carrier quoting integrations are phase 2.</p></Card>
    </div>
  );
}
