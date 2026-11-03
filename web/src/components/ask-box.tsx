"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** The question box on My Day. It hands the question over inside this tab, so only something typed here is asked straight away. */
export function AskBox({ userId, suggestions, disabled = false }: { userId: number; suggestions: string[]; disabled?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const go = (question: string) => {
    try { sessionStorage.setItem(`ams:assistant:ask:${userId}`, question); } catch { router.push(`/assistant?q=${encodeURIComponent(question)}`); return; }
    router.push("/assistant");
  };
  return (
    <div className="mb-5">
      <form className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 shadow-sm focus-within:border-indigo-300" onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(q.trim()); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask the AI Assistant anything" aria-label="Ask the AI Assistant" autoComplete="off" maxLength={4000} disabled={disabled}
          className="min-w-0 flex-1 rounded-md border-0 px-2 py-1 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none disabled:opacity-50" />
        <button disabled={disabled || !q.trim()} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Ask</button>
      </form>
      {disabled ? <p className="mt-1.5 text-xs text-slate-500"><Link href="/assistant" className="underline">The AI Assistant</Link> isn&apos;t available right now.</p>
        : <div className="mt-2 flex flex-wrap gap-1.5">{suggestions.map((s) => <button key={s} type="button" onClick={() => go(s)} className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700">{s}</button>)}</div>}
    </div>
  );
}
