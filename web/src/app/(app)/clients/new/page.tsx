import { createClientAction } from "../actions";
import { ClientForm } from "../client-form";
import { Flash, PageHeader } from "@/components/ui";
import { q } from "@/lib/db";
import { activeUsers, currentUser } from "@/lib/user";

export const metadata = { title: "New client" };

export default async function NewClient({ searchParams }: { searchParams: Promise<{ error?: string; kind?: string; then?: string }> }) {
  const sp = await searchParams;
  const [users, branches, user] = await Promise.all([activeUsers(), q<{ id: number; name: string }>("SELECT id, name FROM branches ORDER BY id"), currentUser()]);
  return (
    <div className="max-w-5xl">
      <Flash error={sp.error} />
      <PageHeader crumbs={[{ href: "/clients", label: "Clients" }]} title="New client or prospect" subtitle="Starts as a prospect and becomes an insured when the first policy binds." />
      <ClientForm action={createClientAction} users={users.map(({ id, full_name, role }) => ({ id, full_name, role }))} branches={branches} isNew after={sp.then === "opportunity" ? "opportunity" : undefined} v={{ kind: sp.kind ?? "business", branch_id: user.branch_id, producer_id: user.role === "producer" ? user.id : null, account_manager_id: user.role === "account_manager" ? user.id : null }} />
    </div>
  );
}
