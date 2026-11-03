import { notFound } from "next/navigation";
import { updateClientAction } from "../../actions";
import { ClientForm, type ClientFormValues } from "../../client-form";
import { PageHeader } from "@/components/ui";
import { one, q } from "@/lib/db";
import { whenDate } from "@/lib/format";
import { activeUsers } from "@/lib/user";

export const metadata = { title: "Edit client" };

export default async function EditClient({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Only what the form edits: this goes to the browser, and the row also holds the date of birth, license and FEIN.
  const row = await one<ClientFormValues & { sms_consent_at: Date | null }>(
    `SELECT id, name, kind, dba, industry, naics, website, email, phone, address1, address2, city, state, zip, source, household, preferred_channel, notes,
            producer_id, account_manager_id, csr_id, branch_id, employees, years_in_business, annual_revenue, tags, do_not_call, email_opt_out, sms_consent_at
       FROM clients WHERE id = $1`, [Number(id)]);
  if (!row) notFound();
  const { sms_consent_at, ...c } = row;
  const [users, branches] = await Promise.all([activeUsers(), q<{ id: number; name: string }>("SELECT id, name FROM branches ORDER BY id")]);
  return (
    <div className="max-w-5xl">
      <PageHeader crumbs={[{ href: "/clients", label: "Clients" }, { href: `/clients/${id}`, label: c.name ?? "Client" }]} title={`Edit ${c.name}`} />
      <ClientForm action={updateClientAction} v={{ ...c, sms_since: sms_consent_at ? whenDate(sms_consent_at) : null }} users={users.map(({ id, full_name, role }) => ({ id, full_name, role }))} branches={branches} />
    </div>
  );
}
