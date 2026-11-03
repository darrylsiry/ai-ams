import { createClaimAction } from "../actions";
import { ClientPicker } from "@/components/client-picker";
import { Submit } from "@/components/submit";
import { Card, Field, PageHeader, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { lobLabel } from "@/lib/ref";

export const metadata = { title: "Record claim" };

const KINDS = ["Auto — collision", "Auto — comprehensive", "Auto — glass", "Property — water", "Property — wind/hail", "Property — fire", "Property — theft", "General liability — bodily injury", "General liability — property damage", "Workers compensation — injury", "Commercial auto — collision", "Professional liability", "Cyber incident", "Other"];

export default async function NewClaim({ searchParams }: { searchParams: Promise<{ client?: string; policy?: string; task?: string }> }) {
  const sp = await searchParams;
  const clientId = Number(sp.client) || null;
  if (!clientId) return <div className="max-w-3xl"><PageHeader crumbs={[{ href: "/claims", label: "Claims" }]} title="Record claim" /><Card pad><form className="flex items-end gap-2"><Field label="Insured" className="flex-1"><ClientPicker name="client" required scope="insured" /></Field><button className={cls.btnPrimary}>Continue</button></form></Card></div>;
  const [client, policies, task] = await Promise.all([one<{ name: string }>("SELECT name FROM clients WHERE id = $1", [clientId]),
    q<{ id: number; policy_number: string; lob: string; carrier: string }>("SELECT p.id, p.policy_number, p.lob, ca.name AS carrier FROM policies p JOIN carriers ca ON ca.id = p.carrier_id WHERE p.client_id = $1 AND p.status IN ('active','pending_cancel','bound','expired','cancelled') ORDER BY p.status = 'active' DESC, p.expiration_date DESC", [clientId]),
    sp.task ? one<{ description: string | null }>("SELECT description FROM activities WHERE id = $1", [Number(sp.task)]) : null]);
  return (
    <div className="max-w-4xl">
      <PageHeader crumbs={[{ href: "/claims", label: "Claims" }, { href: `/clients/${clientId}`, label: client?.name ?? "" }]} title={`Record claim · ${client?.name}`} subtitle="Pick the main policy. Tick any other policy that may apply. Don't offer an opinion on coverage — that's the carrier's call." />
      <form action={createClaimAction} className="space-y-5"><input type="hidden" name="client_id" value={clientId} /><input type="hidden" name="task_id" value={sp.task ?? ""} />
        <Card title="Loss" pad><div className="grid gap-4 sm:grid-cols-3">
          <Field label="Policy"><select name="policy_id" defaultValue={sp.policy ?? ""} className={cls.input}><option value="">Unknown</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.policy_number} · {lobLabel(p.lob)} · {p.carrier}</option>)}</select></Field>
          <Field label="Type"><select name="kind" className={cls.input}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
          <Field label="Date of loss"><input type="date" name="loss_date" required defaultValue={todayISO()} max={todayISO()} className={cls.input} /></Field>
          {policies.length > 1 && <fieldset className="sm:col-span-3"><legend className={cls.label}>Also notify</legend>
            <div className="mt-1 space-y-1">{policies.map((p) => <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="also_notify" value={p.id} /> {p.policy_number} · {lobLabel(p.lob)} · {p.carrier}</label>)}</div>
            <p className="mt-1 text-xs text-slate-500">Each one ticked gets its own task to notify that carrier, umbrella included.</p></fieldset>}
          <Field label="What happened" className="sm:col-span-3"><textarea name="description" rows={4} required defaultValue={task?.description?.split("\n\n")[0] ?? ""} className={cls.input} /></Field>
          <Field label="Location"><input name="location" className={cls.input} /></Field>
          <Field label="Claimant / other party"><input name="claimant" className={cls.input} /></Field>
        </div></Card>
        <Card title="Carrier" pad><div className="grid gap-4 sm:grid-cols-4">
          <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" name="reported" /> Already reported to the carrier</label>
          <Field label="Carrier claim number"><input name="carrier_claim_number" className={cls.input} /></Field>
          <Field label="Adjuster"><input name="adjuster_name" className={cls.input} /></Field>
          <Field label="Adjuster phone"><input name="adjuster_phone" className={cls.input} /></Field>
          <Field label="Adjuster email"><input name="adjuster_email" type="email" className={cls.input} /></Field>
        </div></Card>
        <Submit className={cls.btnPrimary}>Record claim</Submit>
      </form>
    </div>
  );
}
