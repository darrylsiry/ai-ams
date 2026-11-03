import { createTaskAction } from "../actions";
import { ClientPicker } from "@/components/client-picker";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, PageHeader, cls } from "@/components/ui";
import { pickedClient } from "@/lib/client-search";
import { q } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { lobLabel } from "@/lib/ref";
import { activeUsers, currentUser } from "@/lib/user";
import { activityCodes } from "@/lib/work";

export const metadata = { title: "New task" };

export default async function NewTask({ searchParams }: { searchParams: Promise<{ client?: string; policy?: string; claim?: string; code?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await currentUser();
  const clientId = Number(sp.client) || null;
  const [codes, users, picked] = await Promise.all([activityCodes(), activeUsers(), pickedClient(clientId)]);
  const policies = clientId ? await q<{ id: number; policy_number: string; lob: string }>("SELECT id, policy_number, lob FROM policies WHERE client_id = $1 AND status IN ('active','bound','pending_cancel') ORDER BY expiration_date", [clientId]) : [];
  const categories = [...new Set(codes.map((c) => c.category))];
  return (
    <div className="max-w-3xl">
      <Flash error={sp.error} />
      <PageHeader crumbs={[{ href: "/tasks", label: "Tasks" }]} title="New task" />
      <form className="mb-4 flex items-end gap-2" action="/tasks/new">
        <Field label="Client" className="flex-1"><ClientPicker key={clientId ?? "none"} name="client" initial={picked} loads="new-task" /></Field>
        <button className={cls.btn}>Load policies</button>
      </form>
      <Card pad>
        <form id="new-task" action={createTaskAction} className="grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="client_id" value={clientId ?? ""} /><input type="hidden" name="claim_id" value={sp.claim ?? ""} />
          <Field label="Type" className="sm:col-span-2">
            <select name="code" defaultValue={sp.code ?? "FOLLOW-UP"} className={cls.input}>
              {categories.map((cat) => <optgroup key={cat} label={cat}>{codes.filter((c) => c.category === cat).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</optgroup>)}
            </select>
          </Field>
          <Field label="Subject" className="sm:col-span-2"><input name="subject" required placeholder="What needs to happen" className={cls.input} /></Field>
          <Field label="Details" className="sm:col-span-2"><textarea name="description" rows={3} className={cls.input} /></Field>
          <Field label="Policy"><select name="policy_id" defaultValue={sp.policy ?? ""} className={cls.input} disabled={!clientId}><option value="">{clientId ? "No policy" : "Pick a client first"}</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.policy_number} · {lobLabel(p.lob)}</option>)}</select></Field>
          <Field label="Owner"><select name="owner_id" defaultValue={user.id} className={cls.input}>{users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
          <Field label="Priority" hint="Leave on default to use the type's priority"><select name="priority" defaultValue="" className={cls.input}><option value="">Default for type</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></Field>
          <Field label="Due" hint="Leave empty to use the type's standard turnaround"><input type="date" name="due_date" min={todayISO()} className={cls.input} /></Field>
          <div className="sm:col-span-2"><Submit className={cls.btnPrimary}>Create task</Submit></div>
        </form>
      </Card>
    </div>
  );
}
