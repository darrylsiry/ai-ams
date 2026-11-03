"use client";
import { useEffect, useRef, useState } from "react";
import { cls } from "@/components/ui";

/** Pick several with plain clicks or taps (UX-033). Posts like a multi-select: one `name` per ticked box, so the server's getAll() is the same. */
export function CheckList({ name, legend, options, initial = [], className = "" }: { name: string; legend: string; options: { value: string; label: string }[]; initial?: string[]; className?: string }) {
  const [picked, setPicked] = useState(() => new Set(initial));
  const box = useRef<HTMLFieldSetElement>(null);
  const start = useRef(initial);
  // React resets a form after its action runs; the count has to follow.
  useEffect(() => {
    const form = box.current?.form;
    const reset = () => setPicked(new Set(start.current));
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, []);
  const toggle = (v: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(v); else n.delete(v); return n; });
  return (
    <fieldset ref={box} className={`min-w-0 ${className}`}>
      {legend && <legend className={cls.label}>{legend}</legend>}
      <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-300 bg-white px-2.5 py-1.5">
        {options.map((o) => <label key={o.value} className="flex items-center gap-2 text-sm text-slate-900"><input type="checkbox" name={name} value={o.value} checked={picked.has(o.value)} onChange={(e) => toggle(o.value, e.target.checked)} /> {o.label}</label>)}
      </div>
      <p aria-live="polite" className="mt-1 text-[11px] text-slate-500">{picked.size} selected</p>
    </fieldset>
  );
}
