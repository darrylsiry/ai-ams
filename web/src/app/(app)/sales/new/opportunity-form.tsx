"use client";
import { Fragment, useActionState } from "react";
import { createOpportunityAction } from "../actions";
import { CheckList } from "@/components/check-list";
import { ClientPicker } from "@/components/client-picker";
import { Submit } from "@/components/submit";
import { Field, Flash, cls } from "@/components/ui";
import { fieldsOf } from "@/lib/form-state";

export function OpportunityForm({ picked, ownerId, users, lobs }: { picked: { id: number; name: string } | null; ownerId: number; users: { id: number; full_name: string }[]; lobs: { value: string; label: string }[] }) {
  const [state, action] = useActionState(createOpportunityAction, null);
  const { text, all } = fieldsOf(state);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {state && <div className="sm:col-span-2"><Flash error={state.error} /></div>}
      <Field label="Client or prospect" className="sm:col-span-2"><ClientPicker name="client_id" required initial={picked} label="Client or prospect" /></Field>
      <Fragment key={state?.at ?? 0}>
        <Field label="Name" className="sm:col-span-2"><input name="name" required defaultValue={text("name")} placeholder="e.g. Commercial package — new business" className={cls.input} /></Field>
        <Field label="Kind"><select name="kind" defaultValue={text("kind", "new")} className={cls.input}><option value="new">New business</option><option value="cross_sell">Cross-sell</option><option value="remarket">Remarket</option></select></Field>
        <CheckList name="lines" legend="Lines" options={lobs} initial={all("lines")} />
        <Field label="Estimated premium"><input name="est_premium" inputMode="decimal" defaultValue={text("est_premium")} className={cls.input} /></Field>
        <Field label="Target date"><input type="date" name="target_date" defaultValue={text("target_date")} className={cls.input} /></Field>
        <Field label="Owner"><select name="owner_id" defaultValue={text("owner_id", String(ownerId))} className={cls.input}>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
        <Field label="Source"><input name="source" defaultValue={text("source")} placeholder="Referral, website…" className={cls.input} /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea name="notes" rows={2} defaultValue={text("notes")} className={cls.input} /></Field>
      </Fragment>
      <div><Submit className={cls.btnPrimary}>Create</Submit></div>
    </form>
  );
}
