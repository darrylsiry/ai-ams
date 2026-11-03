import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Admin" };

export default async function Admin() {
  const u = await currentUser();
  const items = [
    { href: "/admin/users", title: "Users & roles", text: "Profiles, roles, offices, email aliases, producer splits, licenses.", admin: true },
    { href: "/reports/users", title: "Sign-ins", text: "Who signed in, from where; failed attempts.", admin: true },
    { href: "/admin/audit", title: "Audit trail", text: "Every change, append-only.", admin: true },
    { href: "/admin/settings", title: "Settings & automation", text: "Agency details, renewal lead times, activity codes and service standards, daily automation.", admin: true },
    { href: "/admin/carriers", title: "Carriers & markets", text: "Carriers, wholesalers and MGAs; commission agreements; portals.", admin: true },
    { href: "/admin/roadmap", title: "Roadmap: not in MVP", text: "Every feature shown in the app that is deferred, and why.", admin: false },
    { href: "/admin/app-tests", title: "App Tests", text: "What the independent code, security, UX and UAT agents have found, and what became of it.", admin: true },
    { href: "/admin/assistant", title: "AI Assistant use", text: "Who asked the assistant what, what it looked at and how much it used.", admin: true },
    { href: "/admin/system", title: "System status", text: "Database, Claude, inbound email, automation, deployment settings.", admin: true },
  ];
  return (
    <div>
      <PageHeader title="Admin" subtitle={can(u, "admin") ? "You have administrator access." : "Some areas need the administrator role."} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{items.map((i) => <Link key={i.href} href={i.href} className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 ${i.admin && !can(u, "admin") ? "opacity-60" : ""}`}><div className="font-semibold text-slate-900">{i.title}</div><p className="mt-1 text-sm text-slate-500">{i.text}</p></Link>)}</div>
    </div>
  );
}
