"use client";
import Link from "next/link";
import { Fragment, useActionState, useEffect, useRef } from "react";
import { Submit } from "@/components/submit";
import { Card, Field, cls } from "@/components/ui";
import { plural } from "@/lib/format";
import { fieldsOf, type Rejected } from "@/lib/form-state";
import { STATES } from "@/lib/ref";
import type { User } from "@/lib/user";

export type ClientFormValues = Partial<{
  id: number; name: string; kind: string; dba: string | null; industry: string | null; naics: string | null; website: string | null; email: string | null; phone: string | null;
  address1: string | null; address2: string | null; city: string | null; state: string | null; zip: string | null; source: string | null; household: string | null; preferred_channel: string;
  notes: string | null; producer_id: number | null; account_manager_id: number | null; csr_id: number | null; branch_id: number | null; employees: number | null; years_in_business: number | null;
  annual_revenue: string | null; tags: string[]; do_not_call: boolean; email_opt_out: boolean; sms_since: string | null;
}>;

export type ClientDuplicate = { id: number; name: string; code: string; policies: number };
export type ClientFormState = (Rejected & { duplicates?: ClientDuplicate[] }) | null;

export function ClientForm({ action, v = {}, users, branches, isNew, after }: { action: (state: ClientFormState, f: FormData) => Promise<ClientFormState>; v?: ClientFormValues; users: Pick<User, "id" | "full_name" | "role">[]; branches: { id: number; name: string }[]; isNew?: boolean; after?: string }) {
  const [state, formAction] = useActionState(action, null);
  const banner = useRef<HTMLDivElement>(null);
  useEffect(() => { if (state) banner.current?.scrollIntoView({ block: "center" }); }, [state]);
  const role = (r: string[]) => users.filter((u) => r.includes(u.role));
  const { text, on } = fieldsOf(state);
  const t = (k: keyof ClientFormValues) => text(k, String(v[k] ?? ""));
  return (
    <form action={formAction} className="space-y-5">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      {after && <input type="hidden" name="after" value={after} />}
      {state && (
        <div ref={banner} role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-200">
          {state.duplicates?.length ? <>
            <ul className="space-y-1">{state.duplicates.map((d, i) => <li key={d.id}>{i === 0 ? "Possible duplicate of " : "or "}<Link href={`/clients/${d.id}`} className="font-medium underline">{d.name}</Link> · {d.code} · {plural(d.policies, "policy", "policies")} <Link href={`/clients/${d.id}`} className={`${cls.btnSm} ml-1`}>Open existing</Link></li>)}</ul>
            <button type="submit" name="confirm_duplicate" value="on" className={`${cls.btn} mt-2`}>Create anyway</button>
          </> : state.error}
        </div>
      )}
      <Fragment key={state?.at ?? 0}>
      <Card title="Account" pad>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" className="sm:col-span-2"><input name="name" required defaultValue={t("name")} className={cls.input} /></Field>
          <Field label="Type"><select name="kind" defaultValue={t("kind") || "business"} className={cls.input}><option value="business">Commercial (business)</option><option value="individual">Personal (individual/household)</option></select></Field>
          <Field label="DBA"><input name="dba" defaultValue={t("dba")} className={cls.input} /></Field>
          <Field label="Industry"><input name="industry" defaultValue={t("industry")} className={cls.input} /></Field>
          <Field label="NAICS"><input name="naics" defaultValue={t("naics")} className={cls.input} /></Field>
          <Field label="Employees"><input name="employees" type="number" min={0} defaultValue={t("employees")} className={cls.input} /></Field>
          <Field label="Annual revenue"><input name="annual_revenue" type="number" min={0} defaultValue={t("annual_revenue")} className={cls.input} /></Field>
          <Field label="Years in business"><input name="years_in_business" type="number" min={0} defaultValue={t("years_in_business")} className={cls.input} /></Field>
          <Field label="Household (personal lines)"><input name="household" defaultValue={t("household")} className={cls.input} /></Field>
          <Field label="Source"><input name="source" defaultValue={t("source")} placeholder="Referral, website…" className={cls.input} /></Field>
          <Field label="Tags" hint="Comma separated"><input name="tags" defaultValue={text("tags", (v.tags ?? []).join(", "))} className={cls.input} /></Field>
        </div>
      </Card>
      <Card title="Contact details" pad>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Email"><input name="email" type="email" defaultValue={t("email")} className={cls.input} /></Field>
          <Field label="Phone"><input name="phone" defaultValue={t("phone")} className={cls.input} /></Field>
          <Field label="Website"><input name="website" defaultValue={t("website")} className={cls.input} /></Field>
          <Field label="Address" className="sm:col-span-2"><input name="address1" defaultValue={t("address1")} className={cls.input} /></Field>
          <Field label="Address line 2"><input name="address2" defaultValue={t("address2")} className={cls.input} /></Field>
          <Field label="City"><input name="city" defaultValue={t("city")} className={cls.input} /></Field>
          <Field label="State"><select name="state" defaultValue={t("state") || "NC"} className={cls.input}>{STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="ZIP"><input name="zip" defaultValue={t("zip")} className={cls.input} /></Field>
          <Field label="Preferred channel"><select name="preferred_channel" defaultValue={t("preferred_channel") || "email"} className={cls.input}><option value="email">Email</option><option value="phone">Phone</option><option value="sms">Text</option><option value="mail">Mail</option></select></Field>
          <div className="space-y-1.5 pt-5 text-sm text-slate-700 sm:col-span-2">
            <label className="flex items-center gap-2"><input type="checkbox" name="do_not_call" defaultChecked={on("do_not_call", v.do_not_call)} /> Do not call</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="email_opt_out" defaultChecked={on("email_opt_out", v.email_opt_out)} /> Opted out of marketing email</label>
            {!isNew && <label className="flex items-center gap-2"><input type="checkbox" name="sms_consent" defaultChecked={on("sms_consent", !!v.sms_since)} /> Has given consent to text messages (TCPA) {v.sms_since && <span className="text-xs text-slate-500">since {v.sms_since}</span>}</label>}
          </div>
        </div>
      </Card>
      {isNew && (
        <Card title="Primary contact" pad>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="First name"><input name="contact_first" defaultValue={text("contact_first")} className={cls.input} /></Field>
            <Field label="Last name"><input name="contact_last" defaultValue={text("contact_last")} className={cls.input} /></Field>
            <Field label="Title"><input name="contact_title" defaultValue={text("contact_title")} className={cls.input} /></Field>
            <Field label="Email"><input name="contact_email" defaultValue={text("contact_email")} type="email" className={cls.input} /></Field>
            <Field label="Phone"><input name="contact_phone" defaultValue={text("contact_phone")} className={cls.input} /></Field>
          </div>
        </Card>
      )}
      <Card title="Servicing" pad>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Producer"><select name="producer_id" defaultValue={t("producer_id")} className={cls.input}><option value="">—</option>{role(["producer", "principal"]).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
          <Field label="Account manager"><select name="account_manager_id" defaultValue={t("account_manager_id")} className={cls.input}><option value="">—</option>{role(["account_manager", "principal"]).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
          <Field label="CSR"><select name="csr_id" defaultValue={t("csr_id")} className={cls.input}><option value="">—</option>{role(["csr", "account_manager"]).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
          <Field label="Branch"><select name="branch_id" defaultValue={t("branch_id")} className={cls.input}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Notes" className="sm:col-span-4"><textarea name="notes" rows={2} defaultValue={t("notes")} className={cls.input} /></Field>
        </div>
      </Card>
      {isNew && <div className="space-y-1.5 text-sm text-slate-700">
        <label className="flex items-center gap-2"><input type="checkbox" name="create_lead_task" defaultChecked={on("create_lead_task", true)} /> Create a &quot;new lead&quot; task for the producer</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="confirm_duplicate" /> Create anyway if it looks like a duplicate</label>
      </div>}
      </Fragment>
      <Submit className={cls.btnPrimary}>{isNew ? "Create client" : "Save changes"}</Submit>
    </form>
  );
}
