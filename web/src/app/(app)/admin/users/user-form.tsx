import { saveUserAction } from "../actions";
import { Submit } from "@/components/submit";
import { Card, Field, cls } from "@/components/ui";
import { ROLE_LABEL } from "@/lib/user";

export type UserForm = Partial<{ id: number; username: string; full_name: string; email: string; title: string | null; role: string; branch_id: number | null; phone: string | null; inbox_alias: string; can_view_pii: boolean; commission_new_pct: string; commission_renewal_pct: string; active: boolean; color: string }>;

export function UserFields({ v, branches, isAdmin }: { v: UserForm; branches: { id: number; name: string }[]; isAdmin: boolean }) {
  const dis = !isAdmin;
  return (
    <form action={saveUserAction}>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <Card title="Profile" pad>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="User ID (sign-in name)"><input name="username" defaultValue={v.username} disabled={!!v.id} required className={cls.input} /></Field>
          <Field label="Full name"><input name="full_name" required defaultValue={v.full_name} className={cls.input} /></Field>
          <Field label="Title"><input name="title" defaultValue={v.title ?? ""} className={cls.input} /></Field>
          <Field label="Email (their own mailbox — forwarding from it is recognized)"><input name="email" type="email" required defaultValue={v.email} disabled={dis} className={cls.input} /></Field>
          <Field label="Phone"><input name="phone" defaultValue={v.phone ?? ""} className={cls.input} /></Field>
          <Field label="AMS inbox alias" hint="Their personal forwarding address: alias@INBOUND_EMAIL_DOMAIN"><input name="inbox_alias" defaultValue={v.inbox_alias} disabled={dis} className={cls.input} /></Field>
          <Field label="Role"><select name="role" defaultValue={v.role ?? "csr"} disabled={dis} className={cls.input}>{Object.entries(ROLE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Office"><select name="branch_id" defaultValue={v.branch_id ?? ""} disabled={dis} className={cls.input}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Color"><input name="color" type="color" defaultValue={v.color ?? "#6366f1"} disabled={dis} className="h-9 w-16 rounded border border-slate-300" /></Field>
          <Field label="Producer split, new business %"><input name="commission_new_pct" inputMode="decimal" defaultValue={v.commission_new_pct ?? "0"} disabled={dis} className={cls.input} /></Field>
          <Field label="Producer split, renewal %"><input name="commission_renewal_pct" inputMode="decimal" defaultValue={v.commission_renewal_pct ?? "0"} disabled={dis} className={cls.input} /></Field>
          <div className="space-y-1.5 pt-5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="can_view_pii" defaultChecked={v.can_view_pii} disabled={dis} /> May see sensitive identifiers (DOB, license, FEIN)</label>
            {v.id && <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={v.active ?? true} disabled={dis} /> Active</label>}
          </div>
        </div>
        <div className="mt-4"><Submit className={cls.btnPrimary}>{v.id ? "Save" : "Create profile"}</Submit></div>
      </Card>
    </form>
  );
}
