"use client";
import { useEffect, useId, useRef, useState } from "react";
import { cls, Status } from "@/components/ui";

export type ClientPick = { id: number; name: string; code: string; city: string | null; state: string | null; status: string; note: string | null };
type Match = ClientPick;
type Picked = { id: number; name: string };

const MIN = 2;
const NOT_CHOSEN = "Choose a client from the list.";
const NOT_LOADED = "This form is still for another client. Press the Load button by the client box first.";

/**
 * Search-as-you-type client field. Posts the chosen client's id under `name`; typing clears the choice.
 * `scope` and `exclude` narrow the list the way the screen's rules do (see lib/client-search).
 * `loads` names a form built for the client in `initial`: while the picker shows anything else that form
 * can't be submitted, so what the picker shows is always what gets saved (UX-037).
 * Give it a `key` of the loaded client, so a navigation that changes `initial` starts it afresh.
 * `label` is the name it is announced by, usually its visible label; `onPick` hears each choice, and null when typing clears it.
 */
export function ClientPicker({ name, initial = null, required = false, scope, exclude, loads, label = "Client", onPick }: { name: string; initial?: Picked | null; required?: boolean; scope?: "insured" | "business" | "open_balance"; exclude?: number; loads?: string; label?: string; onPick?: (m: ClientPick | null) => void }) {
  const [text, setText] = useState(initial?.name ?? "");
  const [picked, setPicked] = useState<Picked | null>(initial);
  const [results, setResults] = useState<Match[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "done" | "failed">("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const stale = useRef<HTMLInputElement>(null);
  const listId = useId();
  const term = text.trim();
  const mismatch = !!loads && ((picked?.id ?? null) !== (initial?.id ?? null) || (!picked && !!term));

  // Typed text alone can't be saved, even where no client is allowed: the id has to come from the list.
  useEffect(() => { input.current?.setCustomValidity(!picked && term ? NOT_CHOSEN : ""); }, [picked, term]);

  useEffect(() => { stale.current?.setCustomValidity(mismatch ? NOT_LOADED : ""); }, [mismatch]);

  useEffect(() => {
    if (picked || term.length < MIN) { setResults([]); setState("idle"); return; }
    setState("loading");
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, ...(scope ? { scope } : {}), ...(exclude ? { exclude: String(exclude) } : {}) });
        const res = await fetch(`/clients/lookup?${params}`, { signal: ctl.signal });
        if (!res.ok) throw new Error(String(res.status));
        setResults((await res.json()).clients);
        setActive(0);
        setState("done");
      } catch {
        if (!ctl.signal.aborted) { setResults([]); setState("failed"); }
      }
    }, 200);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [term, picked, scope, exclude]);

  const choose = (m: Match) => { setPicked({ id: m.id, name: m.name }); setText(m.name); setOpen(false); onPick?.(m); };
  const showList = open && !picked && term.length >= MIN;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "Enter" && !picked) {
      e.preventDefault();   // Enter picks from the list; it never saves a half-typed name
      if (showList && results.at(active)) choose(results.at(active)!);
      return;
    }
    if (!showList || !results.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
  }

  const note = state === "loading" ? "Searching…" : state === "failed" ? "Search isn't working. Try again." : state === "done" && !results.length ? "No clients match." : null;
  return (
    <div className="relative">
      <input type="hidden" name={name} value={picked?.id ?? ""} />
      {loads && <input ref={stale} form={loads} tabIndex={-1} aria-hidden className="sr-only" />}
      <input ref={input} type="text" role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={showList} aria-controls={listId} autoComplete="off" required={required}
        aria-activedescendant={showList && results.length ? `${listId}-${active}` : undefined}
        value={text} placeholder="Search name, contact or policy number…" className={cls.input}
        onChange={(e) => { setText(e.target.value); if (picked) onPick?.(null); setPicked(null); setOpen(true); }}
        onFocus={(e) => { if (picked) e.target.select(); setOpen(true); }} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      {mismatch && !showList && <p role="status" className="mt-1 text-xs text-amber-700">What&apos;s below is for {initial?.name ?? "no client"}, and can&apos;t be saved until it matches. Press Load to switch (it clears anything you typed below).</p>}
      {showList && (
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {note && <p role="status" className="px-3 py-2 text-xs text-slate-500">{note}</p>}
          <ul id={listId} role="listbox" aria-label="Matching clients">
            {results.map((m, i) => (
              <li key={m.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                className={`cursor-pointer px-3 py-2 text-sm ${i === active ? "bg-indigo-50" : ""}`}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(m); }}>
                <div className="flex flex-wrap items-center gap-2 font-medium text-slate-900">{m.name} <Status s={m.status} /></div>
                <div className="text-xs text-slate-500">{[m.code, [m.city, m.state].filter(Boolean).join(", "), m.note].filter(Boolean).join(" · ")}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
