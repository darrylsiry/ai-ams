import Link from "next/link";
import { cls } from "@/components/ui";
import type { Paging } from "@/lib/paging";

/** Previous and next links under a long list. Shows nothing when everything fits on one page. */
export function Pager({ at, href, label = "Pages", compact = false }: { at: Paging; href: (page: number) => string; label?: string; compact?: boolean }) {
  if (at.pages <= 1) return null;
  const step = (to: number, text: string, on: boolean) => on
    ? <Link href={href(to)} prefetch={false} className={cls.btnSm}>{text}</Link>
    : <span aria-disabled className={`${cls.btnSm} cursor-not-allowed opacity-40`}>{text}</span>;
  return (
    <nav aria-label={label} className={compact ? "flex items-center justify-between gap-1 px-1 pt-2 text-[11px] text-slate-500" : "flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500"}>
      <span className="tabular-nums">{at.first}–{at.last} of {at.total}</span>
      <span className="flex items-center gap-1.5">
        {step(at.page - 1, compact ? "‹" : "Previous", at.page > 1)}
        {!compact && <span className="px-1 tabular-nums">Page {at.page} of {at.pages}</span>}
        {step(at.page + 1, compact ? "›" : "Next", at.page < at.pages)}
      </span>
    </nav>
  );
}
