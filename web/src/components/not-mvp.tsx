import Link from "next/link";
import { ROADMAP, roadmapBadge } from "@/lib/roadmap";

// Annotation for anything shown in the UI that is not part of the MVP (requirement: every such
// function is labeled). The feature can't be used: the control only links to its row in
// Admin → Roadmap, which says why it is unavailable and lists every annotated feature. The badge
// says when in staff language, and the tooltip repeats the reason and the master catalog ID.

export function NotInMvp({ id, label, variant = "button", className = "" }: { id: string; label?: string; variant?: "button" | "inline" | "panel" | "menu"; className?: string }) {
  const r = ROADMAP[id];
  const text = label ?? r?.label ?? id;
  const badge = roadmapBadge(r);
  const title = `${badge}: ${text} (${r?.id ?? id}, ${r?.phase ?? "Phase 2"}). ${r?.why ?? ""}`;
  const href = `/admin/roadmap#${r?.id ?? id}`;
  const badgeCls = r?.kind === "pending" ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-600";
  if (variant === "panel") {
    return (
      <Link href={href} prefetch={false} title={title} className={`block cursor-help rounded-lg border border-dashed border-slate-300 bg-slate-50/70 px-4 py-3 text-sm text-slate-500 hover:border-slate-400 ${className}`}>
        <div className="flex items-center gap-2"><span className="font-medium text-slate-600">{text}</span><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badgeCls}`}>{badge}</span><span className="text-[11px] text-slate-500">{r?.id}</span></div>
        <p className="mt-1 text-xs">{r?.why} <span className="text-slate-500">({r?.phase})</span></p>
      </Link>
    );
  }
  if (variant === "inline" || variant === "menu") {
    return <Link href={href} prefetch={false} title={title} className={`inline-flex cursor-help items-center gap-1.5 text-slate-500 hover:text-slate-700 ${variant === "menu" ? "w-full px-3 py-2 text-sm" : ""} ${className}`}>{text}<span className={`rounded px-1 py-px text-[9px] font-semibold uppercase ${badgeCls}`}>{badge}</span></Link>;
  }
  return (
    <Link href={href} prefetch={false} title={title} className={`inline-flex cursor-help items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-400 hover:text-slate-700 ${className}`}>
      {text}<span className={`rounded px-1 py-px text-[9px] font-semibold uppercase ${badgeCls}`}>{badge}</span>
    </Link>
  );
}
