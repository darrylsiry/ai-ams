import Link from "next/link";
import { notFound } from "next/navigation";
import { addLicenseAction, endSessionsAction } from "../../actions";
import { UserFields, type UserForm } from "../user-form";
import { NotInMvp } from "@/components/not-mvp";
import { Submit } from "@/components/submit";
import { Card, Field, Flash, PageHeader, Pill, Table, cls } from "@/components/ui";
import { loadUsers } from "@/lib/basic-auth";
import { one, q } from "@/lib/db";
import { daysBetween, todayISO, whenShort } from "@/lib/format";
import { STATES } from "@/lib/ref";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "User" };

export default async function UserPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; error?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await currentUser();
  const u = await one<UserForm & { last_active_at: Date | null }>("SELECT * FROM users WHERE id = $1", [Number(id)]);
  if (!u) notFound();
  const isAdmin = can(me, "admin");
  if (!isAdmin && me.id !== u.id) return <p className="text-sm text-slate-600">Only administrators can view other users.</p>;
  const [branches, licenses, logins, recent] = await Promise.all([q<{ id: number; name: string }>("SELECT id, name FROM branches ORDER BY id"),
    q<{ id: number; state: string; license_number: string; lines: string; expires_on: string }>("SELECT * FROM licenses WHERE user_id = $1 ORDER BY expires_on", [u.id]),
    q<{ occurred_at: Date; success: boolean; ip: string | null; place: string | null }>("SELECT occurred_at, success, ip, concat_ws(', ', geo->>'city', geo->>'region') AS place FROM login_events WHERE username = $1 ORDER BY occurred_at DESC LIMIT 10", [u.username]),
    q<{ occurred_at: Date; action: string; summary: string }>("SELECT occurred_at, action, summary FROM audit_events WHERE actor = $1 ORDER BY id DESC LIMIT 10", [u.username])]);
  const hasLogin = loadUsers(process.env).has(u.username!);
  return (
    <div className="max-w-6xl">
      <Flash msg={sp.msg} error={sp.error} />
      <PageHeader crumbs={[{ href: "/admin/users", label: "Users" }]} title={u.full_name} subtitle={<span className="flex items-center gap-2"><span className="font-mono">{u.username}</span>{loadUsers(process.env).size ? (hasLogin ? <Pill tone="green">password set</Pill> : <Pill tone="red">no password yet</Pill>) : <Pill>sign-in off locally</Pill>}</span>}
        actions={<><Link href={`/reports/users?user=${u.username}`} className={cls.btn}>Sign-ins &amp; actions</Link>{isAdmin && <form action={endSessionsAction}><input type="hidden" name="id" value={u.id} /><Submit className={cls.btnDanger} confirm={`Sign ${u.full_name} out on every device?`}>End all sessions</Submit></form>}</>} />
      <UserFields v={u} branches={branches} isAdmin={isAdmin} />
      {!hasLogin && loadUsers(process.env).size > 0 && <div className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">Issue a password from your machine: <span className="font-mono">scripts/fly-users.sh {u.username}</span></div>}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card title="Licenses (CMP-01)">
          <Table head={["State", "Number", "Expires"]} empty="None on file.">{licenses.map((l) => { const d = daysBetween(todayISO(), l.expires_on); return <tr key={l.id}><td className={cls.td}>{l.state}</td><td className={`${cls.td} font-mono text-xs`}>{l.license_number}</td><td className={`${cls.td} text-xs ${d <= 60 ? "text-rose-600" : ""}`}>{l.expires_on}</td></tr>; })}</Table>
          {isAdmin && <form action={addLicenseAction} className="grid grid-cols-3 gap-2 border-t border-slate-100 p-3"><input type="hidden" name="id" value={u.id} /><select name="state" className={cls.input}>{STATES.map((s) => <option key={s}>{s}</option>)}</select><input name="license_number" placeholder="Number" required className={cls.input} /><input type="date" name="expires_on" required className={cls.input} /><Submit className={`${cls.btnSm} col-span-3`}>Add license</Submit></form>}
          <div className="border-t border-slate-100 p-3"><NotInMvp id="CMP-02" /></div>
        </Card>
        <Card title="Recent sign-ins"><Table head={["When", "Result", "Where"]} empty="Never signed in.">{logins.map((l, i) => <tr key={i}><td className={`${cls.td} text-xs`}>{whenShort(l.occurred_at)}</td><td className={cls.td}>{l.success ? <Pill tone="green">ok</Pill> : <Pill tone="red">failed</Pill>}</td><td className={`${cls.td} text-xs`}>{l.place || l.ip || "—"}</td></tr>)}</Table></Card>
        <Card title="Recent actions"><ul className="divide-y divide-slate-100">{recent.map((r, i) => <li key={i} className="px-4 py-2 text-xs"><span className="text-slate-400">{whenShort(r.occurred_at)}</span> <span className="font-mono text-slate-500">{r.action}</span><div className="text-slate-700">{r.summary}</div></li>)}</ul></Card>
      </div>
    </div>
  );
}
