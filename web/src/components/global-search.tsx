"use client";
import { usePathname, useSearchParams } from "next/navigation";

/** The header search box. On the results page it keeps the query, so refining doesn't mean retyping (UX-025). */
export function GlobalSearchInput() {
  const path = usePathname();
  const params = useSearchParams();
  const q = path === "/search" ? params.get("q") ?? "" : "";
  return <input key={q} id="global-search" name="q" defaultValue={q} placeholder="Search clients, policies, claims, emails…  ( / )" aria-label="Search"
    className="w-full max-w-lg rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm focus:border-indigo-500 focus:bg-white focus:outline-none" />;
}
