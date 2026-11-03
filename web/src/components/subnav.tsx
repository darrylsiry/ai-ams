"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SubNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 text-sm">
      {items.map((i) => {
        const active = i.href === items[0].href ? path === i.href : path.startsWith(i.href);
        return <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 ${active ? "border-indigo-600 font-medium text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{i.label}</Link>;
      })}
    </nav>
  );
}
