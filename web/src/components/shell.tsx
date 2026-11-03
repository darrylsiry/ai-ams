"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavItem = { href: string; label: string; icon: string; count?: number; countTone?: "red" | "indigo" | "slate"; section?: string };

const ICONS: Record<string, string> = {
  day: "M3 12l9-9 9 9M5 10v10h14V10", assistant: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z", tasks: "M9 11l3 3 8-8M4 6h4M4 12h2M4 18h4", inbox: "M3 13h5l2 3h4l2-3h5M5 5h14l2 8v6H3v-6z",
  clients: "M16 11a4 4 0 10-8 0M4 20a8 8 0 0116 0", policies: "M7 3h7l5 5v13H7zM14 3v5h5", renewals: "M4 4v6h6M20 20v-6h-6M5 13a7 7 0 0012 3M19 11A7 7 0 007 8",
  sales: "M4 19h16M7 15l4-4 3 3 5-6", certs: "M6 3h12v14l-6 4-6-4zM9 8h6M9 12h6", claims: "M12 3l9 16H3zM12 10v4M12 17v.5",
  accounting: "M4 7h16M4 12h16M4 17h10", reports: "M5 20V10M12 20V4M19 20v-7", admin: "M12 8a4 4 0 100 8 4 4 0 000-8zM3 12h2M19 12h2M12 3v2M12 19v2",
};

function Icon({ name }: { name: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name] ?? ICONS.day} /></svg>;
}

export function Sidebar({ items, agency }: { items: NavItem[]; agency: string }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  let lastSection: string | undefined;
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-300 md:flex">
      <Link href="/" className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">S</span>
        <span className="leading-tight"><span className="block text-sm font-semibold text-white">siryous AMS</span><span className="block text-[11px] text-slate-400">{agency}</span></span>
      </Link>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4 text-sm">
        {items.map((i) => {
          const header = i.section && i.section !== lastSection ? i.section : null;
          lastSection = i.section ?? lastSection;
          return (
            <div key={i.href}>
              {header && <div className="mt-4 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{header}</div>}
              <Link href={i.href} aria-current={active(i.href) ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 ${active(i.href) ? "bg-slate-800 font-medium text-white" : "hover:bg-slate-800/60 hover:text-white"}`}>
                <Icon name={i.icon} /><span className="flex-1">{i.label}</span>
                {!!i.count && <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${i.countTone === "red" ? "bg-rose-500 text-white" : i.countTone === "indigo" ? "bg-indigo-500 text-white" : "bg-slate-700 text-slate-200"}`}>{i.count}</span>}
              </Link>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="flex gap-3 overflow-x-auto border-b border-slate-200 bg-slate-900 px-3 py-2 text-xs text-slate-200 md:hidden">
      {items.map((i) => <Link key={i.href} href={i.href} className="whitespace-nowrap">{i.label}{i.count ? ` (${i.count})` : ""}</Link>)}
    </nav>
  );
}

/** A small click-to-open menu. Closes on Escape, outside click, or navigation. */
export function Menu({ label, children, align = "right", buttonClass }: { label: React.ReactNode; children: React.ReactNode; align?: "left" | "right"; buttonClass?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={buttonClass ?? "inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"}>{label}</button>
      {open && <div role="menu" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}
        className={`absolute top-full z-30 mt-1.5 w-60 overflow-hidden rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg ${align === "right" ? "right-0" : "left-0"}`}>{children}</div>}
    </div>
  );
}

/** Global keyboard shortcuts: "/" focuses search, "n" starts the next task (outside text fields). */
export function Shortcuts() {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") { e.preventDefault(); (document.getElementById("global-search") as HTMLInputElement | null)?.focus(); }
      if (e.key === "n") { window.location.href = "/tasks/next"; }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return null;
}
