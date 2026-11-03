import Link from "next/link";
import { NotInMvp } from "@/components/not-mvp";
import { PageHeader } from "@/components/ui";
import { can, currentUser } from "@/lib/user";

export const metadata = { title: "Reports" };

// A producer's own figures, scoped to the signed-in user on the server (UX-034).
const MINE = [
  { href: "/reports/my-production", title: "My production", text: "Your new and renewal premium and estimated commission by month, carrier and line." },
  { href: "/reports/my-commissions", title: "My commission statements", text: "Your statements by period, with the policies behind each one. Read-only." },
];

const REPORTS = [
  { href: "/reports/activity", title: "Activity", text: "Tasks created and completed by person and by type; turnaround, on-time rate, service standards met, open and overdue work." },
  { href: "/reports/users", title: "Users & sign-ins", text: "Who signed in, from where, how often; failed attempts; actions per person; full sign-in and audit history." },
  { href: "/reports/production", title: "Production", text: "New and renewal premium and commission by month, producer, carrier, line and office." },
  { href: "/reports/book", title: "Book of business", text: "In-force premium, policies and clients by line, carrier, account manager and personal vs commercial." },
  { href: "/reports/renewals", title: "Renewals & retention", text: "Retention by month, renewal rate change, lost business with reasons, upcoming expirations." },
  { href: "/reports/commissions", title: "Commissions", text: "Commission income by month and source; carrier statements received vs expected." },
  { href: "/reports/email", title: "Email intake", text: "Email volume, Claude vs rules classification, client match rate, triage backlog, time from email to done." },
  { href: "/reports/claims", title: "Claims", text: "Claims reported by type, open claims, time open." },
  { href: "/accounting/invoices?status=pastdue", title: "Receivables aging", text: "Agency-bill balances by age (in Accounting)." },
  { href: "/admin/audit", title: "Audit trail", text: "Every change in the system: who, what, when, before and after." },
];

export default async function Reports() {
  const u = await currentUser();
  // SEC-002: agency-wide numbers need reports.all; commission and receivables need accounting; sign-ins need admin.
  const shown = u.role === "producer" ? MINE : REPORTS.filter((r) => r.href === "/reports/users" || r.href === "/admin/audit" ? can(u, "admin")
    : r.href === "/reports/commissions" || r.href.startsWith("/accounting") ? can(u, "accounting.view") : can(u, "reports.all"));
  return (
    <div>
      <PageHeader title="Reports" subtitle={u.role === "producer" ? "Your own production and commission statements." : can(u, "reports.all") ? "Agency-wide reports. Every table downloads as CSV." : "Agency-wide reports are for principals, administrators and accounting."} actions={<><NotInMvp id="RPT-02" /><NotInMvp id="RPT-14" /></>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => <Link key={r.href} href={r.href} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300"><div className="font-semibold text-slate-900">{r.title}</div><p className="mt-1 text-sm text-slate-500">{r.text}</p></Link>)}
      </div>
    </div>
  );
}
