import Link from "next/link";
import { setUserAction } from "../actions";
import { GlobalSearchInput } from "@/components/global-search";
import { Menu, MobileNav, Shortcuts, Sidebar, type NavItem } from "@/components/shell";
import { Avatar } from "@/components/ui";
import { ensureDailyAutomation } from "@/lib/automation";
import { one } from "@/lib/db";
import { todayISO } from "@/lib/format";
import { ROLE_LABEL, activeUsers, authEnabled, can, currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  ensureDailyAutomation();
  const today = todayISO();
  const [counts, agency, users] = await Promise.all([
    one<{ due: number; urgent: number; emails: number; renewals: number }>(
      `SELECT
         (SELECT count(*)::int FROM activities WHERE owner_id = $1 AND ((status = 'open' AND due_date <= $2 AND (snoozed_until IS NULL OR snoozed_until <= $2))
                                                                      OR (status = 'waiting' AND follow_up_date <= $2))) AS due,
         (SELECT count(*)::int FROM activities WHERE owner_id = $1 AND status = 'open' AND priority = 'urgent') AS urgent,
         (SELECT count(*)::int FROM emails WHERE status = 'new' AND (routed_user_id = $1 OR ($3 AND routed_user_id IS NULL))) AS emails,
         (SELECT count(*)::int FROM policies WHERE coalesce(renewal_owner_id, account_manager_id) = $1 AND status IN ('active','pending_cancel')
             AND renewal_policy_id IS NULL AND renewal_stage NOT IN ('renewed','lost','non_renewed') AND expiration_date BETWEEN $2::date AND $2::date + 60) AS renewals`,
      [user.id, today, can(user, "team")]),
    one<{ value: { name: string } }>("SELECT value FROM settings WHERE key = 'agency'"),
    authEnabled() ? Promise.resolve([]) : activeUsers(),
  ]);
  const items: NavItem[] = [
    { href: "/", label: "My day", icon: "day", count: counts?.due, countTone: counts?.urgent ? "red" : "indigo" },
    { href: "/tasks", label: "Tasks", icon: "tasks" },
    { href: "/assistant", label: "AI Assistant", icon: "assistant" },
    { href: "/inbox", label: "Email inbox", icon: "inbox", count: counts?.emails, countTone: "indigo" },
    { href: "/clients", label: "Clients", icon: "clients", section: "Book" },
    { href: "/policies", label: "Policies", icon: "policies" },
    { href: "/renewals", label: "Renewals", icon: "renewals", count: counts?.renewals, countTone: "slate" },
    { href: "/sales", label: "Sales pipeline", icon: "sales" },
    { href: "/certificates", label: "Certificates", icon: "certs" },
    { href: "/claims", label: "Claims", icon: "claims" },
    ...(can(user, "accounting.view") ? [{ href: "/accounting", label: "Accounting", icon: "accounting", section: "Back office" } as NavItem] : []),
    { href: "/reports", label: "Reports", icon: "reports", section: can(user, "accounting.view") ? undefined : "Back office" },
    { href: "/admin", label: "Admin", icon: "admin" },
  ];
  return (
    <div className="flex min-h-screen">
      <Shortcuts />
      <Sidebar items={items} agency={agency?.value.name ?? "Agency"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav items={items} />
        <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-5 py-2.5 backdrop-blur">
          <form action="/search" className="min-w-0 flex-1">
            <GlobalSearchInput />
          </form>
          <Link href="/tasks/next" className="inline-flex whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500" title="Open your highest-priority task (n)">Next task →</Link>
          <Menu label={<>＋ New</>}>
            {[["/tasks/new", "Task"], ["/clients/new", "Client or prospect"], ["/policies/new", "Policy"], ["/certificates/new", "Certificate"], ["/claims/new", "Claim"], ["/sales/new", "Opportunity"], ...(!authEnabled() || can(user, "admin") ? [["/inbox/simulate", "Email (test intake)"]] : [])].map(([h, l]) => (
              <Link key={h} href={h} role="menuitem" className="block px-3 py-2 text-slate-700 hover:bg-slate-50">{l}</Link>
            ))}
          </Menu>
          {authEnabled() ? (
            <Menu label={<span className="flex items-center gap-2"><Avatar name={user.full_name} color={user.color} size={6} /><span className="hidden lg:inline">{user.full_name}</span></span>}
              buttonClass="rounded-md px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-100">
              <div className="border-b border-slate-100 px-3 py-2 text-xs text-slate-500">{ROLE_LABEL[user.role]} · forward email to <span className="font-mono">{user.inbox_alias}@{process.env.INBOUND_EMAIL_DOMAIN || "inbox"}</span></div>
              <Link href={`/admin/users/${user.id}`} className="block px-3 py-2 hover:bg-slate-50">My profile</Link>
              <form method="post" action="/signout"><button className="w-full px-3 py-2 text-left hover:bg-slate-50">Sign out</button></form>
            </Menu>
          ) : (
            <form action={setUserAction} className="flex items-center gap-1.5 text-xs text-slate-500" title="Local development: no sign-in, pick who you are working as">
              <Avatar name={user.full_name} color={user.color} size={6} />
              <label htmlFor="working-as" className="hidden xl:inline">Working as</label>
              <select id="working-as" name="username" defaultValue={user.username} className="rounded border border-slate-300 bg-white px-1.5 py-1 text-xs text-slate-800">
                {users.map((u) => <option key={u.id} value={u.username}>{u.full_name} · {ROLE_LABEL[u.role]}</option>)}
              </select>
              <button className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">Switch</button>
            </form>
          )}
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-5">{children}</main>
      </div>
    </div>
  );
}
