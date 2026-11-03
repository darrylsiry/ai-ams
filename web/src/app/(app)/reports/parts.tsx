import { yearStart } from "@/lib/format";
import Link from "next/link";
import { cls } from "@/components/ui";
import type { Range } from "@/lib/reports";

/** Date range, quick presets and CSV export: the same header on every report. */
export function RangeBar({ r, path, csv, extra }: { r: Range; path: string; csv?: string; extra?: React.ReactNode }) {
  return (
    <form className="mb-5 flex flex-wrap items-end gap-2 text-sm" action={path}>
      <label className="text-slate-600">From <input type="date" name="from" defaultValue={r.from} className={`${cls.inputInline} w-auto`} /></label>
      <label className="text-slate-600">To <input type="date" name="to" defaultValue={r.to} className={`${cls.inputInline} w-auto`} /></label>
      {extra}
      <button className={cls.btn}>Apply</button>
      <span className="flex gap-1">{[["7", "7d"], ["30", "30d"], ["90", "90d"]].map(([d, l]) => <Link key={d} href={`${path}?days=${d}`} className={cls.btnSm}>{l}</Link>)}<Link href={`${path}?from=${yearStart()}`} className={cls.btnSm}>YTD</Link></span>
      {csv && <a href={`/reports/csv?r=${csv}&from=${r.from}&to=${r.to}`} className={`${cls.btnSm} ml-auto`}>Download CSV</a>}
    </form>
  );
}
