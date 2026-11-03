import Link from "next/link";
import { Pager } from "@/components/pager";
import { Card, PageHeader, Pill, Stat, Tabs, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { daysBetween, money, pct, todayISO } from "@/lib/format";
import { paging } from "@/lib/paging";
import { lobLabel, RENEWAL_STAGE_LABEL } from "@/lib/ref";
import { activeUsers, currentUser } from "@/lib/user";
import { qs } from "@/lib/url";

export const metadata = { title: "Renewals" };

// Renewal pipeline (REN-01..26): every in-force policy expiring inside the window, by stage, so the
// team can see what's not started, what's out to market, and what's waiting on the client.

type Row = { id: number; policy_number: string; lob: string; premium: string; expiration_date: string; renewal_stage: string; client_id: number; client_name: string; owner: string | null; owner_color: string | null; open_tasks: number; remarket_reason: string | null };

const COLUMNS = ["not_started", "in_review", "remarketing", "quoted", "presented"] as const;
/** Cards per column. Each column pages on its own, so its count and premium always cover the whole stage. */
const COLUMN_SIZE = 25;
const pageParam = (stage: string) => `page_${stage}`;

export default async function Renewals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const view = sp.view ?? (user.role === "account_manager" ? "mine" : "all");
  const days = Number(sp.days ?? 60);   // the same window as My day and the sidebar (UX-004)
  const today = todayISO();
  const params: unknown[] = [today, days];
  let filter = "";
  if (view === "mine") { params.push(user.id); filter = `AND coalesce(p.renewal_owner_id, p.account_manager_id) = $${params.length}`; }
  if (sp.owner) { params.push(Number(sp.owner)); filter = `AND coalesce(p.renewal_owner_id, p.account_manager_id) = $${params.length}`; }
  if (sp.type) { params.push(sp.type); filter += ` AND p.business_type = $${params.length}`; }
  const inWindow = `p.status IN ('active','pending_cancel') AND p.renewal_policy_id IS NULL AND p.renewal_stage NOT IN ('renewed','lost','non_renewed')
      AND p.expiration_date BETWEEN $1::date AND $1::date + $2::int ${filter}`;
  const stages = await q<{ stage: string; n: number; premium: string }>(`SELECT p.renewal_stage AS stage, count(*)::int AS n, coalesce(sum(p.premium), 0)::text AS premium FROM policies p WHERE ${inWindow} GROUP BY p.renewal_stage`, params);
  const stageOf = (stage: string) => stages.find((s) => s.stage === stage) ?? { stage, n: 0, premium: "0" };
  const atStage = Object.fromEntries(COLUMNS.map((stage) => [stage, paging(sp[pageParam(stage)], stageOf(stage).n, COLUMN_SIZE)]));
  const rows = await q<Row>(`SELECT x.* FROM (
      SELECT p.id, p.policy_number, p.lob, p.premium, p.expiration_date, p.renewal_stage, c.id AS client_id, c.name AS client_name, u.full_name AS owner, u.color AS owner_color, p.remarket_reason,
        (SELECT count(*)::int FROM activities a WHERE a.policy_id = p.id AND a.status IN ('open','waiting')) AS open_tasks,
        row_number() OVER (PARTITION BY p.renewal_stage ORDER BY p.expiration_date, p.id) AS rn
      FROM policies p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = coalesce(p.renewal_owner_id, p.account_manager_id)
      WHERE ${inWindow}) x
    JOIN unnest($${params.length + 1}::text[], $${params.length + 2}::int[]) AS w(stage, skip) ON w.stage = x.renewal_stage
    WHERE x.rn > w.skip AND x.rn <= w.skip + ${COLUMN_SIZE} ORDER BY x.expiration_date, x.id`,
    [...params, [...COLUMNS], COLUMNS.map((stage) => atStage[stage].offset)]);
  const firstPages = Object.fromEntries(COLUMNS.map((stage) => [pageParam(stage), undefined]));
  const ytd = await one<{ due: number; renewed: number; lost: number; premium_due: string; premium_kept: string; uprate: string | null }>(`
    SELECT count(*)::int AS due, count(*) FILTER (WHERE renewal_policy_id IS NOT NULL)::int AS renewed, count(*) FILTER (WHERE renewal_stage IN ('lost','non_renewed') OR (renewal_policy_id IS NULL AND status IN ('lost','non_renewed')))::int AS lost,
           coalesce(sum(premium),0)::text AS premium_due, coalesce(sum(premium) FILTER (WHERE renewal_policy_id IS NOT NULL),0)::text AS premium_kept,
           (SELECT avg((r.premium - p2.premium) / nullif(p2.premium,0) * 100)::text FROM policies p2 JOIN policies r ON r.id = p2.renewal_policy_id WHERE p2.expiration_date BETWEEN date_trunc('year', $1::date)::date AND $1::date AND r.carrier_id = p2.carrier_id) AS uprate
      FROM policies WHERE expiration_date BETWEEN date_trunc('year', $1::date)::date AND $1::date AND status <> 'cancelled'`, [today]);
  const users = await activeUsers();
  const count = stages.reduce((s, r) => s + r.n, 0);
  const total = stages.reduce((s, r) => s + Number(r.premium), 0);
  const retention = ytd!.due ? (ytd!.renewed / ytd!.due) * 100 : 0;
  return (
    <div>
      <PageHeader title="Renewals" subtitle={`${count} ${count === 1 ? "policy" : "policies"} · ${money(total)} premium expiring in the next ${days} days`} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Policy retention, year to date" value={pct(retention)} sub={`${ytd!.renewed} of ${ytd!.due} expiring terms renewed`} tone={retention >= 88 ? "green" : "amber"} />
        <Stat label="Premium retained" value={pct(Number(ytd!.premium_kept) / Math.max(1, Number(ytd!.premium_due)) * 100)} sub={`${money(ytd!.premium_kept)} of ${money(ytd!.premium_due)}`} />
        <Stat label="Lost or non-renewed" value={ytd!.lost} tone={ytd!.lost ? "red" : "slate"} href="/reports/renewals" />
        <Stat label="Average renewal rate change" value={`${Number(ytd!.uprate ?? 0) >= 0 ? "+" : ""}${Number(ytd!.uprate ?? 0).toFixed(1)}%`} sub="same-carrier renewals, YTD" />
      </div>
      <Tabs current={view} tabs={[{ key: "mine", label: "My renewals", href: qs(sp, { ...firstPages, view: "mine", owner: undefined }) }, { key: "all", label: "Everyone", href: qs(sp, { ...firstPages, view: "all", owner: undefined }) }]} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        <select name="days" defaultValue={String(days)} className={`${cls.inputInline} w-auto`}>{[30, 60, 90, 120].map((d) => <option key={d} value={d}>Next {d} days</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Personal &amp; commercial</option><option value="personal">Personal</option><option value="commercial">Commercial</option></select>
        {view === "all" && <select name="owner" defaultValue={sp.owner ?? ""} className={`${cls.inputInline} w-auto`}><option value="">Any owner</option>{users.filter((u) => u.role === "account_manager").map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>}
        <button className={cls.btn}>Apply</button>
      </form>
      <div className="grid gap-3 lg:grid-cols-5">
        {COLUMNS.map((stage) => {
          const col = rows.filter((r) => r.renewal_stage === stage);
          return (
            <div key={stage} className="flex min-w-0 flex-col rounded-lg bg-slate-100/80 p-2">
              <div className="mb-2 flex items-center justify-between px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                <span>{RENEWAL_STAGE_LABEL[stage]}</span><span className="tabular-nums text-slate-500">{stageOf(stage).n} · {money(stageOf(stage).premium)}</span>
              </div>
              <div className="space-y-2">
                {col.length === 0 && <div className="rounded-md border border-dashed border-slate-300 px-2 py-4 text-center text-xs text-slate-400">None</div>}
                {col.map((r) => {
                  const left = daysBetween(today, r.expiration_date);
                  return (
                    <Link key={r.id} href={`/policies/${r.id}?tab=renewal`} className="block rounded-md border border-slate-200 bg-white p-2.5 shadow-sm hover:border-indigo-300">
                      <div className="flex items-start justify-between gap-2"><span className="truncate text-sm font-medium text-slate-900">{r.client_name}</span>
                        <span className={`shrink-0 text-xs font-semibold tabular-nums ${left <= 15 ? "text-rose-600" : left <= 30 ? "text-amber-600" : "text-slate-500"}`}>{left}d</span></div>
                      <div className="mt-0.5 text-xs text-slate-500">{lobLabel(r.lob)} · {money(r.premium)}</div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1 truncate text-[11px] text-slate-500"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.owner_color ?? "#94a3b8" }} />{r.owner}</span>
                        {r.open_tasks > 0 ? <Pill tone="amber">{r.open_tasks} task{r.open_tasks === 1 ? "" : "s"}</Pill> : stage === "not_started" && left <= 45 ? <Pill tone="red">no work yet</Pill> : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
              <Pager compact at={atStage[stage]} href={(page) => qs(sp, { [pageParam(stage)]: String(page) })} label={`${RENEWAL_STAGE_LABEL[stage]} pages`} />
            </div>
          );
        })}
      </div>
      <Card className="mt-5" pad><p className="text-xs text-slate-500">Renewal reviews start automatically at each line&apos;s lead time (personal 45 days, commercial 90, accounts over $25,000 at 120), set in Admin → Settings. A renewal a week from expiring with nothing renewed raises a high-priority task.</p></Card>
    </div>
  );
}
