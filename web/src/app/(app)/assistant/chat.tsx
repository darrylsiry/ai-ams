"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import type { AssistantEvent, Turn } from "@/lib/assistant";

type ToolStep = { id: string; name: string; input: unknown; ms?: number; ok?: boolean };
type Message = { role: "user" | "assistant"; text: string; steps: ToolStep[]; error?: string; pending?: boolean; meta?: string };

const describeInput = (input: unknown) => Object.entries((input ?? {}) as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ");
const stepName = (name: string) => name.replace(/_/g, " ");

/** Answers link into the app, so a conversation survives following one and coming back. Per tab, and per person. */
function storeFor(userId: number) {
  const key = `ams:assistant:chat:${userId}`;
  return {
    load: (): Message[] => { try { return (JSON.parse(sessionStorage.getItem(key) ?? "[]") as Message[]).filter((m) => !m.pending); } catch { return []; } },
    save: (m: Message[]) => { try { sessionStorage.setItem(key, JSON.stringify(m.filter((x) => !x.pending).slice(-40))); } catch { /* full or blocked: it just won't come back */ } },
    clear: () => { try { sessionStorage.removeItem(key); } catch { /* blocked */ } },
  };
}

export function AssistantChat({ userId, firstName, model, enabled, offReason, suggestions, prefill }: { userId: number; firstName: string; model: string; enabled: boolean; offReason?: string; suggestions: string[]; prefill?: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState(prefill ?? "");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  const stopper = useRef<AbortController | null>(null);
  const store = useRef(storeFor(userId)).current;

  useEffect(() => { if (messages.length) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length, busy]);
  useEffect(() => { if (started.current) store.save(messages); }, [messages, store]);

  // Bring back this tab's conversation, and ask what the My Day box handed over. Only a question typed
  // in the app arrives this way: a link's ?q= fills the box and waits, so no link can spend or ask for anyone.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const earlier = store.load();
    setMessages(earlier);
    let handed: string | null = null;
    try { const key = `ams:assistant:ask:${userId}`; handed = sessionStorage.getItem(key); sessionStorage.removeItem(key); } catch { /* blocked */ }
    if (prefill) window.history.replaceState(null, "", "/assistant");
    if (handed && enabled) void ask(handed, earlier);
    else if (handed) setInput(handed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ask(question: string, earlier: Message[] = messages) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history: Turn[] = earlier.filter((m) => !m.error && !m.pending && m.text).map((m) => ({ role: m.role, text: m.text }));
    setMessages([...earlier, { role: "user", text: q, steps: [] }, { role: "assistant", text: "", steps: [], pending: true }]);
    const update = (fn: (m: Message) => Message) => setMessages((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));
    const stop = new AbortController();
    stopper.current = stop;
    try {
      const res = await fetch("/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history }), signal: stop.signal });
      if (!res.ok || !res.body) {
        const detail = await res.json().catch(() => null) as { error?: string | { message?: string } } | null;
        throw new Error(typeof detail?.error === "string" ? detail.error : detail?.error?.message ?? `The server answered ${res.status}. Reload the page and try again.`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        buffer += decoder.decode(r.value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as AssistantEvent | { type: "ping" };
          if (e.type === "tool") update((m) => ({ ...m, steps: [...m.steps, { id: e.id, name: e.name, input: e.input }] }));
          else if (e.type === "tool_result") update((m) => ({ ...m, steps: m.steps.map((s) => (s.id === e.id ? { ...s, ms: e.ms, ok: e.ok } : s)) }));
          else if (e.type === "answer") update((m) => ({ ...m, text: e.markdown, pending: false, meta: `${e.steps} round${e.steps === 1 ? "" : "s"} · ${(e.usage.input + e.usage.output).toLocaleString("en-US")} tokens${e.usage.cache_read ? ` (${e.usage.cache_read.toLocaleString("en-US")} cached)` : ""}` }));
          else if (e.type === "error") update((m) => ({ ...m, error: e.message, pending: false }));
        }
      }
      update((m) => (m.pending ? { ...m, pending: false, error: m.error ?? "The connection closed before an answer arrived." } : m));
    } catch (err) {
      update((m) => ({ ...m, error: stop.signal.aborted ? "Stopped." : err instanceof TypeError ? "Couldn't reach the server. Check your connection and try again." : (err as Error).message, pending: false }));
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!enabled && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">{offReason}</p>}
      {messages.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-600">Ask about your work, a client, a policy, a certificate, a claim, renewals or the numbers. Answers come from the app&apos;s own data, limited to what your role can see, with links to the records they rest on.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((s) => <button key={s} type="button" onClick={() => void ask(s)} disabled={busy || !enabled} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50">{s}</button>)}
          </div>
        </div>
      )}

      <div className="space-y-4" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            {m.role === "user" ? (
              <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-indigo-600 px-4 py-2 text-sm text-white">{m.text}</div>
            ) : (
              <div className="w-full max-w-[92%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-4 py-3 shadow-sm">
                {m.steps.length > 0 && (
                  <details className="mb-2" open={m.pending}>
                    <summary className="cursor-pointer text-xs text-slate-500">{m.pending ? "Looking it up" : "Looked at"} · {m.steps.length} {m.steps.length === 1 ? "lookup" : "lookups"}</summary>
                    <ol className="mt-1 space-y-0.5 text-xs text-slate-500">
                      {m.steps.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-baseline gap-x-2">
                          <span className="font-medium text-slate-700">{stepName(s.name)}</span>
                          <span className="min-w-0 truncate" title={describeInput(s.input)}>{describeInput(s.input)}</span>
                          <span className="ml-auto whitespace-nowrap tabular-nums">{s.ms === undefined ? "…" : s.ok === false ? `no result · ${s.ms} ms` : `${s.ms} ms`}</span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {m.pending && !m.text && <p className="text-sm text-slate-500"><span className="inline-block animate-pulse">Thinking…</span></p>}
                {m.text && <Markdown source={m.text} appLinksOnly />}
                {m.error && <p role="alert" className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{m.error}</p>}
                {m.error && !busy && i === messages.length - 1 && (
                  <button type="button" className="mt-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium hover:bg-slate-50" onClick={() => void ask(messages[i - 1].text, messages.slice(0, -2))}>Try again</button>
                )}
                {m.meta && <p className="mt-2 text-[11px] text-slate-500">{m.meta}</p>}
              </div>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form className="sticky bottom-4 flex items-end gap-2 rounded-xl border border-slate-200 bg-white p-2 shadow-md" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
        <textarea ref={box} value={input} onChange={(e) => setInput(e.target.value)} rows={2} disabled={!enabled} maxLength={4000} aria-label="Ask the AI Assistant"
          placeholder={`What can I look up, ${firstName}? (Enter to send, Shift+Enter for a new line)`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
          className="min-w-0 flex-1 resize-none rounded-md border-0 px-2 py-1 text-sm text-slate-900 focus:outline-none" />
        {busy
          ? <button type="button" onClick={() => stopper.current?.abort()} className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Stop</button>
          : <button type="submit" disabled={!enabled || !input.trim()} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">Ask</button>}
        {messages.length > 0 && <button type="button" onClick={() => { setMessages([]); store.clear(); box.current?.focus(); }} disabled={busy} className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">New</button>}
      </form>
      <p className="text-center text-[11px] text-slate-500">Powered by the Claude API ({model}). Read-only: it looks things up and links to them, and never changes anything. <Link href="/assistant/about" className="underline">What it can see</Link></p>
    </div>
  );
}
