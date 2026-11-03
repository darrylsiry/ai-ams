import { pickedClient } from "@/lib/client-search";
import Link from "next/link";
import { OpportunityForm } from "./opportunity-form";
import { Card, Flash, PageHeader, cls } from "@/components/ui";
import { LOBS } from "@/lib/ref";
import { activeUsers, currentUser } from "@/lib/user";

export const metadata = { title: "New opportunity" };

export default async function NewOpp({ searchParams }: { searchParams: Promise<{ client?: string; msg?: string; error?: string }> }) {
  const sp = await searchParams;
  const [user, users, picked] = await Promise.all([currentUser(), activeUsers(), pickedClient(Number(sp.client) || null)]);
  return (
    <div className="max-w-3xl">
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/sales", label: "Sales pipeline" }]} title="New opportunity" actions={<Link href="/clients/new?then=opportunity" className={cls.btn}>New prospect first</Link>} />
      <Card pad>
        <OpportunityForm picked={picked} ownerId={user.id} users={users.map(({ id, full_name }) => ({ id, full_name }))} lobs={Object.entries(LOBS).map(([value, v]) => ({ value, label: v.label }))} />
      </Card>
    </div>
  );
}
