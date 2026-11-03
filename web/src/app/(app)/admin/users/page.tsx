import { denied } from "@/components/gate";
import Link from "next/link";
import { NotInMvp } from "@/components/not-mvp";
import { Avatar, Card, Flash, PageHeader, Pill, Table, cls } from "@/components/ui";
import { loadUsers } from "@/lib/basic-auth";
import { q } from "@/lib/db";
import { whenShort } from "@/lib/format";
import { ROLE_LABEL, can, currentUser, type Role } from "@/lib/user";

export const metadata = { title: "Users & roles" };

export default async function Users({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const deny = await denied("admin", "user administration", "administrator");
  if (deny) return deny;
  const sp = await searchParams;
  const me = await currentUser();
  const logins = loadUsers(process.env);
  const rows = await q<{ id: number; username: string; full_name: string; email: string; title: string | null; role: Role; branch: string | null; active: boolean; inbox_alias: string; can_view_pii: boolean; color: string; last_active_at: Date | null; open: number; licenses: number }>(`
    SELECT u.*, b.name AS branch, (SELECT count(*)::int FROM activities a WHERE a.owner_id = u.id AND a.status IN ('open','waiting')) AS open, (SELECT count(*)::int FROM licenses l WHERE l.user_id = u.id) AS licenses
      FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.active DESC, u.role, u.full_name`);
  const domain = process.env.INBOUND_EMAIL_DOMAIN || "amsinbox.siryous.app";
  return (
    <div>
      <Flash msg={sp.msg} />
      <PageHeader crumbs={[{ href: "/admin", label: "Admin" }]} title="Users & roles"
        subtitle={logins.size ? `Sign-in is on: ${logins.size} login(s) configured in BASIC_AUTH_USERS.` : "Sign-in is off (local development): anyone can work as any profile from the header."}
        actions={<><NotInMvp id="ADM-01P" />{can(me, "admin") && <Link href="/admin/users/new" className={cls.btnPrimary}>＋ New user</Link>}</>} />
      <Card className="mb-5" pad>
        <p className="text-sm text-slate-600">Logins work like the Underwriting Desktop: passwords live in the <span className="font-mono">BASIC_AUTH_USERS</span> secret, one per person, issued with <span className="font-mono">scripts/fly-users.sh &lt;user-id&gt;</span> (saved to <span className="font-mono">.fly-credentials</span>, never shown). The profile here decides role, office, email alias and what the person can see. A login with no profile gets a customer-service profile on first sign-in.</p>
      </Card>
      <Card><Table head={["Person", "User ID", "Role", "Office", "Email to AMS", "Access", "Login", "Last active", "Open tasks"]}>
        {rows.map((u) => <tr key={u.id} className={u.active ? "" : "opacity-50"}>
          <td className={cls.td}><Link href={`/admin/users/${u.id}`} className="flex items-center gap-2 font-medium text-slate-900 hover:text-indigo-700"><Avatar name={u.full_name} color={u.color} size={6} />{u.full_name}</Link><div className="ml-8 text-xs text-slate-500">{u.title}</div></td>
          <td className={`${cls.td} font-mono text-xs`}>{u.username}</td><td className={`${cls.td} text-xs`}>{ROLE_LABEL[u.role]}</td><td className={`${cls.td} text-xs`}>{u.branch}</td>
          <td className={`${cls.td} font-mono text-[11px]`}>{u.inbox_alias}@{domain}</td>
          <td className={cls.td}><span className="flex flex-wrap gap-1">{can(u, "admin") && <Pill tone="violet">admin</Pill>}{can(u, "pii") && <Pill tone="amber">PII</Pill>}{can(u, "accounting") && <Pill>accounting</Pill>}{!u.active && <Pill>inactive</Pill>}</span></td>
          <td className={cls.td}>{logins.size ? (logins.has(u.username) ? <Pill tone="green">password set</Pill> : <Pill tone="red">no password</Pill>) : <Pill>local</Pill>}</td>
          <td className={`${cls.td} text-xs`}>{u.last_active_at ? whenShort(u.last_active_at) : "never"}</td><td className={`${cls.td} tabular-nums`}>{u.open}</td>
        </tr>)}
      </Table></Card>
    </div>
  );
}
