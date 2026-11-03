"use client";
import { Fragment, useActionState, useEffect, useRef } from "react";
import { issueAction } from "../actions";
import { HolderChoice } from "./holder-choice";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, cls } from "@/components/ui";
import { fieldsOf } from "@/lib/form-state";

/** Kept as a client form so that a refused certificate comes back as typed, still tied to its client and task (UX-009). */
export function IssueForm({ clientId, taskId, emailOn, holders, selected, replaces, email, description, policies, flags }: { clientId: number; taskId: string; emailOn: boolean; holders: { id: number; label: string }[]; selected: number | null; replaces: Record<number, string>;
  email: string; description: string; policies: { id: number; number: string; label: string; ticked: boolean }[]; flags: { ai: boolean; wos: boolean; pnc: boolean } }) {
  const [state, action] = useActionState(issueAction, null);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state) top.current?.scrollIntoView({ block: "center" }); }, [state]);
  const { text, on, all } = fieldsOf(state);
  const ticked = all("policy_ids", policies.filter((p) => p.ticked).map((p) => String(p.id)));
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="task_id" value={taskId} />
      <div ref={top}><Flash error={state?.error} /></div>
      <Fragment key={state?.at ?? 0}>
        <Card title="Certificate holder" pad>
          <HolderChoice holders={holders} selected={selected} replaces={replaces} text={text} />
          <p className="mt-3 text-xs text-slate-500">★ holders already on certificates for this insured. A new certificate to the same holder supersedes the old one.</p>
        </Card>
        <Card title="Policies on the certificate" pad>
          <div className="space-y-1.5">{policies.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="policy_ids" value={p.id} defaultChecked={ticked.includes(String(p.id))} />
            <span className="font-mono text-xs">{p.number}</span> {p.label}</label>)}</div>
        </Card>
        <Card title="Wording" pad>
          <div className="mb-3 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="ai" defaultChecked={on("ai", flags.ai)} /> Additional insured</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="wos" defaultChecked={on("wos", flags.wos)} /> Waiver of subrogation</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="pnc" defaultChecked={on("pnc", flags.pnc)} /> Primary &amp; non-contributory</label>
          </div>
          <Field label="Description of operations / locations / vehicles"><textarea name="description" rows={3} defaultValue={text("description", description)} className={cls.input} /></Field>
          <p className="mt-2 text-xs text-slate-500">Requested wording is checked against the endorsements on each policy before issuing.</p>
          <label className="mt-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" name="override" defaultChecked={on("override")} /> Issue anyway if a wording check fails (carrier confirmed the endorsement)</label>
        </Card>
        <Card title="Delivery" pad>
          <Field label={emailOn ? "Email to" : "Holder email (kept on record, not sent automatically)"}><input name="delivered_to" type="email" defaultValue={text("delivered_to", email)} placeholder="holder or client email" className={cls.input} /></Field>
        </Card>
      </Fragment>
      <Submit className={cls.btnPrimary}>Issue certificate</Submit>
    </form>
  );
}
