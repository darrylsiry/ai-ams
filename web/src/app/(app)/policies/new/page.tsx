import Link from "next/link";
import { PolicyForm } from "./policy-form";
import { ClientPicker } from "@/components/client-picker";
import { NotInMvp } from "@/components/not-mvp";
import { Card, Field, Flash, PageHeader, cls } from "@/components/ui";
import { one, q } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { LOBS } from "@/lib/ref";

export const metadata = { title: "New policy" };

export default async function NewPolicy({ searchParams }: { searchParams: Promise<{ client?: string; opportunity?: string; carrier?: string; premium?: string; error?: string }> }) {
  const sp = await searchParams;
  const clientId = Number(sp.client) || null;
  const [carriers, wholesalers, finance, client] = await Promise.all([
    q<{ id: number; name: string; bill_modes: string; admitted: boolean; commission_new_pct: string }>("SELECT id, name, bill_modes, admitted, commission_new_pct FROM carriers WHERE kind <> 'wholesaler' AND active ORDER BY name"),
    q<{ id: number; name: string }>("SELECT id, name FROM carriers WHERE kind IN ('wholesaler','mga') ORDER BY name"),
    q<{ id: number; name: string }>("SELECT id, name FROM finance_companies ORDER BY name"),
    clientId ? one<{ name: string; kind: string }>("SELECT name, kind FROM clients WHERE id = $1", [clientId]) : null,
  ]);
  const lobs = Object.entries(LOBS).filter(([, v]) => !client || (client.kind === "individual" ? v.type === "personal" : v.type === "commercial"));
  return (
    <div className="max-w-5xl">
      <Flash error={sp.error} />
      <PageHeader crumbs={[{ href: "/policies", label: "Policies" }]} title="New policy" subtitle="Record a bound or issued policy. Agency-bill policies are invoiced automatically; every new policy gets a setup task and a policy check task."
        actions={<><NotInMvp id="PLC-18" /><NotInMvp id="CON-01" label="Import from download" /></>} />
      {!clientId && (
        <Card pad className="mb-5"><form className="flex items-end gap-2" action="/policies/new">
          <Field label="Client" className="flex-1"><ClientPicker name="client" required /></Field>
          <button className={cls.btnPrimary}>Continue</button> <Link href="/clients/new" className={cls.btn}>New client</Link>
        </form></Card>
      )}
      {clientId && client && <PolicyForm clientId={clientId} clientName={client.name} opportunity={sp.opportunity} carrier={sp.carrier} premium={sp.premium} today={todayISO()}
        lobs={lobs.map(([value, v]) => ({ value, label: v.label }))} carriers={carriers.map(({ id, name, admitted }) => ({ id, name, admitted }))} wholesalers={wholesalers} finance={finance} />}
    </div>
  );
}
