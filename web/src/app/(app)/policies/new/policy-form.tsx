"use client";
import { Fragment, useActionState, useEffect, useRef } from "react";
import { createPolicyAction } from "../actions";
import { CheckList } from "@/components/check-list";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, cls } from "@/components/ui";
import { fieldsOf } from "@/lib/form-state";

type Named = { id: number; name: string };

/** Kept as a client form so that a rejected policy comes back as typed, still tied to its client and opportunity (UX-009). */
export function PolicyForm({ clientId, clientName, opportunity, carrier, premium, today, lobs, carriers, wholesalers, finance }: { clientId: number; clientName: string; opportunity?: string; carrier?: string; premium?: string; today: string;
  lobs: { value: string; label: string }[]; carriers: (Named & { admitted: boolean })[]; wholesalers: Named[]; finance: Named[] }) {
  const [state, action] = useActionState(createPolicyAction, null);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state) top.current?.scrollIntoView({ block: "center" }); }, [state]);
  const { text, all } = fieldsOf(state);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="client_id" value={clientId} />{opportunity && <input type="hidden" name="opportunity_id" value={opportunity} />}
      <div ref={top}><Flash error={state?.error} /></div>
      <Fragment key={state?.at ?? 0}>
        <Card title={`Policy for ${clientName}`} pad>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Line of business"><select name="lob" required defaultValue={text("lob", lobs[0]?.value)} className={cls.input}>{lobs.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}</select></Field>
            <Field label="Policy number" hint="Leave blank if the carrier hasn't issued one yet"><input name="policy_number" defaultValue={text("policy_number")} className={cls.input} /></Field>
            <Field label="Status"><select name="status" defaultValue={text("status", "bound")} className={cls.input}><option value="bound">Bound (binder issued)</option><option value="active">Issued / in force</option></select></Field>
            <Field label="Carrier"><select name="carrier_id" required defaultValue={text("carrier_id", carrier ?? "")} className={cls.input}><option value="" disabled>Choose…</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.admitted ? "" : " (non-admitted)"}</option>)}</select></Field>
            <Field label="Through wholesaler / MGA"><select name="wholesaler_id" defaultValue={text("wholesaler_id")} className={cls.input}><option value="">Direct with carrier</option>{wholesalers.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
            <CheckList name="lines" legend="Additional lines (package)" options={lobs} initial={all("lines")} />
            <Field label="Effective date"><input type="date" name="effective_date" required defaultValue={text("effective_date", today)} className={cls.input} /></Field>
            <Field label="Term"><select name="term_months" defaultValue={text("term_months", "12")} className={cls.input}><option value="12">12 months</option><option value="6">6 months</option><option value="36">36 months</option></select></Field>
            <Field label="Annual premium"><input name="premium" required inputMode="decimal" defaultValue={text("premium", premium ?? "")} placeholder="0.00" className={cls.input} /></Field>
            <Field label="Billing"><select name="bill_mode" defaultValue={text("bill_mode", "direct")} className={cls.input}><option value="direct">Direct bill (carrier bills)</option><option value="agency">Agency bill (we invoice)</option></select></Field>
            <Field label="Commission %" hint="Blank uses the carrier agreement"><input name="commission_pct" inputMode="decimal" defaultValue={text("commission_pct")} className={cls.input} /></Field>
            <Field label="Payment plan"><select name="payment_plan" defaultValue={text("payment_plan", "annual")} className={cls.input}><option value="annual">Annual</option><option value="quarterly">Quarterly</option><option value="monthly EFT">Monthly EFT</option><option value="financed">Premium financed</option></select></Field>
            <Field label="Finance company"><select name="finance_company_id" defaultValue={text("finance_company_id")} className={cls.input}><option value="">None</option>{finance.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            <Field label="Binder number"><input name="binder_number" defaultValue={text("binder_number")} className={cls.input} /></Field>
            <Field label="Binder expires"><input type="date" name="binder_expires" defaultValue={text("binder_expires")} className={cls.input} /></Field>
            <Field label="Description" className="sm:col-span-3"><input name="description" defaultValue={text("description")} className={cls.input} /></Field>
          </div>
        </Card>
        <Card title="Coverages (optional — add more after saving)" pad>
          <div className="space-y-2">{Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-3"><input name={`cov_desc_${i}`} defaultValue={text(`cov_desc_${i}`)} placeholder="Coverage, e.g. Each occurrence" className={cls.input} /><input name={`cov_limit_${i}`} defaultValue={text(`cov_limit_${i}`)} placeholder="Limit" className={cls.input} /><input name={`cov_ded_${i}`} defaultValue={text(`cov_ded_${i}`)} placeholder="Deductible" className={cls.input} /></div>
          ))}</div>
        </Card>
      </Fragment>
      <Submit className={cls.btnPrimary}>Create policy</Submit>
    </form>
  );
}
