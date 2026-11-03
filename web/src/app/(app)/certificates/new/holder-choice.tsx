"use client";
import { useState } from "react";
import { Field, cls } from "@/components/ui";
import type { fieldsOf } from "@/lib/form-state";
import { STATES } from "@/lib/ref";

/** Existing holder or new holder, one at a time: the side not chosen is disabled, so it can't be submitted (UX-010). */
export function HolderChoice({ holders, selected, replaces, text }: { holders: { id: number; label: string }[]; selected: number | null; replaces: Record<number, string>; text: ReturnType<typeof fieldsOf>["text"] }) {
  const [mode, setMode] = useState(text("holder_mode", selected ? "existing" : "new"));
  const start = Number(text("holder_id", String(selected ?? ""))) || null;
  const [picked, setPicked] = useState(start);
  const saved = text("holder_saved");
  const list = saved && start && !holders.some((h) => h.id === start) ? [...holders, { id: start, label: saved }] : holders;
  const replaced = picked ? replaces[picked] : null;
  const radio = (value: "existing" | "new", label: string) => <label className="flex items-center gap-2 text-sm font-medium text-slate-800"><input type="radio" name="holder_mode" value={value} checked={mode === value} onChange={() => setMode(value)} /> {label}</label>;
  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        {radio("existing", "Existing holder")}
        <select name="holder_id" aria-label="Existing holder" disabled={mode !== "existing"} defaultValue={start ?? ""} onChange={(e) => setPicked(Number(e.target.value) || null)} className={`${cls.input} disabled:opacity-50`}><option value="">Choose a holder</option>{list.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}</select>
        {mode === "existing" && replaced && <p className="text-xs font-medium text-amber-800">Issuing replaces {replaced} for this holder</p>}
      </fieldset>
      <div className="space-y-2">
        {radio("new", "New holder")}
        <fieldset disabled={mode !== "new"} className="grid gap-4 disabled:opacity-50 sm:grid-cols-2">
          <Field label="New holder name"><input name="holder_name" defaultValue={text("holder_name")} className={cls.input} /></Field>
          <Field label="Attention"><input name="holder_attention" defaultValue={text("holder_attention")} className={cls.input} /></Field>
          <Field label="Address"><input name="holder_address" defaultValue={text("holder_address")} className={cls.input} /></Field>
          <div className="grid grid-cols-3 gap-2"><Field label="City"><input name="holder_city" defaultValue={text("holder_city")} className={cls.input} /></Field><Field label="State"><select name="holder_state" defaultValue={text("holder_state", STATES[0])} className={cls.input}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></Field><Field label="ZIP"><input name="holder_zip" defaultValue={text("holder_zip")} className={cls.input} /></Field></div>
          <Field label="Holder email"><input name="holder_email" type="email" defaultValue={text("holder_email")} className={cls.input} /></Field>
        </fieldset>
      </div>
    </div>
  );
}
