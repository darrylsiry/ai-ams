"use client";
import Link from "next/link";
import { Fragment, useActionState } from "react";
import { endorseAction } from "../actions";
import { Submit } from "@/components/submit";
import { Field, Flash, cls } from "@/components/ui";
import { fieldsOf } from "@/lib/form-state";

/** From a task the box starts unticked: recording a request isn't the carrier issuing it (UX-008). */
export function EndorseForm({ id, task, today, min, max, agency }: { id: number; task?: string; today: string; min: string; max: string; agency: boolean }) {
  const [state, action] = useActionState(endorseAction, null);
  const { text, on } = fieldsOf(state);
  return (
    <>
      <Flash error={state?.error} />
      <form action={action} className="grid gap-3 sm:grid-cols-4"><input type="hidden" name="id" value={id} /><input type="hidden" name="task_id" value={task ?? ""} />
        <Fragment key={state?.at ?? 0}>
          <Field label="Change" className="sm:col-span-2"><input name="description" required defaultValue={text("description")} placeholder="e.g. Add 2026 Toyota RAV4, VIN …" className={cls.input} /></Field>
          <Field label="Effective"><input type="date" name="effective_date" defaultValue={text("effective_date", today)} min={min} max={max} className={cls.input} /></Field>
          <Field label="Premium change"><div className="flex gap-1"><select name="sign" defaultValue={text("sign", "+")} className={`${cls.inputInline} w-16`}><option value="+">+</option><option value="-">−</option></select><input name="premium_change" inputMode="decimal" defaultValue={text("premium_change")} placeholder="0" className={cls.input} /></div></Field>
          <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="issue_now" defaultChecked={on("issue_now", !task)} className="mt-1" /><span>{task ? <>Carrier has issued it<span className="block text-[11px] text-slate-500">Tick only when you have the carrier&apos;s endorsement</span></> : "Carrier has issued it (otherwise it waits as pending)"}</span></label>
        </Fragment>
        <div className="flex gap-2 sm:col-span-2 sm:justify-end"><Link href={`/policies/${id}`} className={cls.btn}>Close</Link><Submit className={cls.btnPrimary}>Record endorsement</Submit></div>
        {agency && <p className="text-xs text-slate-500 sm:col-span-4">Agency bill: an issued premium change creates an invoice (or credit) automatically.</p>}
      </form>
    </>
  );
}
