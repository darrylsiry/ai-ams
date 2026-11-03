import Link from "next/link";
import type { Reason } from "@/lib/priority";
import { initials } from "@/lib/format";

// Shared building blocks. Server components only (no hooks), so any page can use them.

export const cls = {
  btn: "inline-flex items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50",
  btnPrimary: "inline-flex items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50",
  btnGreen: "inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-500 disabled:opacity-50",
  btnDanger: "inline-flex items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50",
  btnSm: "inline-flex items-center justify-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50",
  input: "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100",
  inputInline: "rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100",
  label: "block text-xs font-medium text-slate-600",
  th: "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500",
  td: "px-3 py-2 align-top text-sm text-slate-700",
  num: "px-3 py-2 text-right align-top text-sm tabular-nums text-slate-700",
  link: "text-indigo-600 hover:underline",
};

export function PageHeader({ title, subtitle, actions, crumbs }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="min-w-[min(100%,16rem)] flex-1">
        {crumbs && <nav className="mb-1 flex flex-wrap gap-1 text-xs text-slate-500">{crumbs.map((c, i) => <span key={c.href}>{i > 0 && <span className="mx-1">/</span>}<Link className="hover:text-slate-800" href={c.href}>{c.label}</Link></span>)}</nav>}
        <h1 className="truncate text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "", pad = false, id }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean; id?: string }) {
  return (
    <section id={id} className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-slate-100 px-4 py-2.5">
          {title && <h2 className="text-[13px] font-semibold text-slate-800">{title}</h2>}
          {action && <div className="ml-auto flex min-w-0 items-center gap-2 text-xs">{action}</div>}
        </div>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, href, tone = "slate" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "slate" | "red" | "amber" | "green" | "indigo" }) {
  const color = { slate: "text-slate-900", red: "text-rose-600", amber: "text-amber-600", green: "text-emerald-600", indigo: "text-indigo-600" }[tone];
  const inner = (
    <div className="h-full rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-slate-300">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
}

const TONES = {
  red: "bg-rose-50 text-rose-700 ring-rose-600/15", amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", blue: "bg-sky-50 text-sky-700 ring-sky-600/15",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/15", slate: "bg-slate-100 text-slate-600 ring-slate-500/10",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/15",
} as const;
export type Tone = keyof typeof TONES;

export function Pill({ children, tone = "slate", title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  active: "green", bound: "indigo", quote: "slate", pending_cancel: "red", cancelled: "slate", non_renewed: "red", lost: "red", expired: "slate",
  open: "amber", waiting: "violet", done: "green", partial: "amber", paid: "green", void: "slate", draft: "slate", posted: "green", issued: "green",
  new: "blue", actioned: "green", linked: "slate", ignored: "slate", closed: "slate", insured: "green", prospect: "blue", inactive: "slate",
  matched: "green", variance: "amber", unmatched: "red", pending: "amber", not_issued: "slate", finalized: "green", reversed: "red",
  renewed: "green", remarketing: "amber", in_review: "indigo", not_started: "slate", quoted: "blue", presented: "violet",
  won: "green", submitted: "indigo", qualifying: "blue", lead: "slate", proposal: "violet", declined: "red", preparing: "slate",
  waiting_on_carrier: "violet", waiting_on_client: "violet", superseded: "slate", revoked: "red",
};
const STATUS_TEXT: Record<string, string> = { active: "in force", pending_cancel: "pending cancel", not_started: "not started", in_review: "in review", non_renewed: "non-renewed", waiting_on_carrier: "waiting on carrier", waiting_on_client: "waiting on client", not_issued: "not issued" };

export function Status({ s }: { s: string }) {
  return <Pill tone={STATUS_TONE[s] ?? "slate"}>{STATUS_TEXT[s] ?? s.replace(/_/g, " ")}</Pill>;
}

export function PriorityBadge({ p }: { p: string }) {
  const map: Record<string, [Tone, string]> = { urgent: ["red", "Urgent"], high: ["amber", "High"], normal: ["slate", "Normal"], low: ["slate", "Low"] };
  const [tone, label] = map[p] ?? ["slate", p];
  return <Pill tone={tone}>{label}</Pill>;
}

export function Reasons({ reasons, max = 4 }: { reasons: Reason[]; max?: number }) {
  return <span className="flex flex-wrap gap-1">{reasons.slice(0, max).map((r) => <Pill key={r.label} tone={r.tone === "blue" ? "blue" : r.tone}>{r.label}</Pill>)}</span>;
}

/** Shown in place of a page the current role can't open. */
export function NoAccess({ what, roles }: { what: string; roles: string }) {
  return <div className="max-w-xl rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><div className="font-semibold">You can&apos;t open {what}</div><p className="mt-1">It needs the {roles} role. Ask an administrator if your role should change.</p></div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Avatar({ name, color = "#6366f1", size = 7 }: { name: string; color?: string; size?: number }) {
  return <span title={name} className={`inline-flex h-${size} w-${size} shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white`} style={{ background: color, width: `${size * 4}px`, height: `${size * 4}px` }}>{initials(name)}</span>;
}

export function KV({ items, cols = 2 }: { items: [string, React.ReactNode][]; cols?: 1 | 2 | 3 | 4 }) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-4" }[cols];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${grid}`}>
      {items.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{k}</dt><dd className="mt-0.5 truncate text-sm text-slate-900">{v ?? "—"}</dd></div>)}
    </dl>
  );
}

export const NEXT_TASK = "Next task →";

export function Flash({ msg, error }: { msg?: string; error?: string }) {
  if (!msg && !error) return null;
  const text = error ?? msg!;
  // A message ending in "Next task →" means an action just closed a task: the words become the way on (UX-022).
  const next = !error && text.endsWith(NEXT_TASK);
  return <div role={error ? "alert" : "status"} className={`mb-4 rounded-md px-3 py-2 text-sm ${error ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"}`}>{next ? <>{text.slice(0, -NEXT_TASK.length)} <Link href="/tasks/next" className="font-medium underline">{NEXT_TASK}</Link></> : text}</div>;
}

export function Tabs({ tabs, current }: { tabs: { key: string; label: string; href: string; count?: number }[]; current: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 ${t.key === current ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
          {t.label}{t.count != null && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function DaysChip({ days, past = "overdue" }: { days: number; past?: string }) {
  const style = days < 0 ? "bg-rose-100 text-rose-800" : days <= 14 ? "bg-rose-50 text-rose-700" : days <= 45 ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600";
  return <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${style}`}>{days < 0 ? `${-days}d ${past}` : days === 0 ? "today" : `${days}d`}</span>;
}

/** A money or count column's head is `{ label, num: true }`, with its cells in `cls.num`, so decimals line up (UX-015). */
export function Table({ head, children, empty }: { head: (React.ReactNode | { label: React.ReactNode; num: true })[]; children: React.ReactNode; empty?: React.ReactNode }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead className="border-b border-slate-200 bg-slate-50/60"><tr>{head.map((h, i) => { const num = !!h && typeof h === "object" && "num" in h; return <th key={i} className={num ? `${cls.th} text-right` : cls.th}>{num ? h.label : h}</th>; })}</tr></thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {rows.length === 0 && empty && <Empty>{empty}</Empty>}
    </div>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return <label className={`block ${className}`}><span className={cls.label}>{label}</span><div className="mt-1">{children}</div>{hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}</label>;
}
