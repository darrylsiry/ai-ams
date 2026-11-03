import { denied } from "@/components/gate";
import { carrierAction } from "../actions";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, PageHeader, Pill, Table, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { money } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Carriers" };

type C = { id: number; code: string; name: string; kind: string; naic: string | null; am_best: string | null; admitted: boolean; bill_modes: string; lines: string[]; phone: string | null; email: string | null; underwriting_email: string | null; portal_url: string | null; commission_new_pct: string; commission_renewal_pct: string; active: boolean; premium: string; policies: number };

export default async function Carriers({ searchParams }: { searchParams: Promise<{ msg?: string; error?: string; edit?: string }> }) {
  const deny = await denied("reports.all", "carriers and commission agreements", "administrator, principal or accounting");
  if (deny) return deny;
  const sp = await searchParams;
  const u = await currentUser();
  const rows = await q<C>(`SELECT ca.*, coalesce((SELECT sum(premium) FROM policies p WHERE p.carrier_id = ca.id AND p.status IN ('active','bound','pending_cancel')),0)::text AS premium,
    (SELECT count(*)::int FROM policies p WHERE p.carrier_id = ca.id AND p.status IN ('active','bound','pending_cancel')) AS policies FROM carriers ca ORDER BY ca.kind, ca.name`);
  const edit = sp.edit ? await one<C>("SELECT * FROM carriers WHERE id = $1", [Number(sp.edit)]) : null;
  return (
    <div>
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/admin", label: "Admin" }]} title="Carriers &amp; markets" subtitle="Commission agreements default the commission on new policies and drive direct-bill reconciliation." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2"><Table head={["Carrier", "Type", "AM Best", "Billing", "Commission new / renewal", "In force", ""]}>
          {rows.map((c) => <tr key={c.id} className={c.active ? "" : "opacity-50"}><td className={cls.td}><div className="font-medium">{c.name}</div><div className="text-[11px] text-slate-400">{c.naic ? `NAIC ${c.naic} · ` : ""}{c.lines.join(", ")}</div></td>
            <td className={cls.td}><span className="flex gap-1"><Pill>{c.kind}</Pill>{!c.admitted && <Pill tone="violet">non-admitted</Pill>}</span></td><td className={`${cls.td} text-xs`}>{c.am_best ?? "—"}</td><td className={`${cls.td} text-xs`}>{c.bill_modes}</td>
            <td className={`${cls.td} text-xs`}>{Number(c.commission_new_pct)}% / {Number(c.commission_renewal_pct)}%</td><td className={`${cls.td} text-xs tabular-nums`}>{money(c.premium)} · {c.policies}</td>
            <td className={`${cls.td} text-right`}>{can(u, "admin") && <a href={`?edit=${c.id}`} className={cls.btnSm}>Edit</a>}</td></tr>)}
        </Table></Card>
        {can(u, "admin") && <Card title={edit ? `Edit ${edit.name}` : "Add carrier or market"} pad>
          <form action={carrierAction} className="grid grid-cols-2 gap-3" key={edit?.id ?? "new"}>{edit && <input type="hidden" name="id" value={edit.id} />}
            <Field label="Name" className="col-span-2"><input name="name" required defaultValue={edit?.name} className={cls.input} /></Field>
            <Field label="Type"><select name="kind" defaultValue={edit?.kind ?? "carrier"} className={cls.input}><option value="carrier">Carrier</option><option value="wholesaler">Wholesaler</option><option value="mga">MGA</option></select></Field>
            <Field label="Billing"><select name="bill_modes" defaultValue={edit?.bill_modes ?? "direct"} className={cls.input}><option value="direct">Direct</option><option value="agency">Agency</option><option value="both">Both</option></select></Field>
            <Field label="NAIC"><input name="naic" defaultValue={edit?.naic ?? ""} className={cls.input} /></Field><Field label="AM Best"><input name="am_best" defaultValue={edit?.am_best ?? ""} className={cls.input} /></Field>
            <Field label="Lines (codes)" className="col-span-2"><input name="lines" defaultValue={edit?.lines.join(", ") ?? ""} placeholder="GL, CA, WC" className={cls.input} /></Field>
            <Field label="Commission new %"><input name="commission_new_pct" defaultValue={edit?.commission_new_pct ?? "12"} className={cls.input} /></Field><Field label="Commission renewal %"><input name="commission_renewal_pct" defaultValue={edit?.commission_renewal_pct ?? "12"} className={cls.input} /></Field>
            <Field label="Underwriting email" className="col-span-2"><input name="underwriting_email" defaultValue={edit?.underwriting_email ?? ""} className={cls.input} /></Field>
            <Field label="Agent portal URL" className="col-span-2"><input name="portal_url" defaultValue={edit?.portal_url ?? ""} className={cls.input} /></Field>
            <Field label="Phone"><input name="phone" defaultValue={edit?.phone ?? ""} className={cls.input} /></Field><Field label="Email"><input name="email" defaultValue={edit?.email ?? ""} className={cls.input} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="admitted" defaultChecked={edit?.admitted ?? true} /> Admitted</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={edit?.active ?? true} /> Active</label>
            <div className="col-span-2"><Submit className={cls.btnPrimary}>Save</Submit></div>
          </form>
        </Card>}
      </div>
    </div>
  );
}
