import { UserFields } from "../user-form";
import { Flash, NoAccess, PageHeader } from "@/components/ui";
import { q } from "@/lib/db";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "New user" };

export default async function NewUser({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!can(await currentUser(), "admin")) return <NoAccess what="new user setup" roles="administrator" />;
  const sp = await searchParams;
  const branches = await q<{ id: number; name: string }>("SELECT id, name FROM branches ORDER BY id");
  return <div className="max-w-5xl"><Flash error={sp.error} /><PageHeader crumbs={[{ href: "/admin/users", label: "Users" }]} title="New user" subtitle="Create the profile here, then issue the password with scripts/fly-users.sh <username>." /><UserFields v={{ role: "csr" }} branches={branches} isAdmin /></div>;
}
