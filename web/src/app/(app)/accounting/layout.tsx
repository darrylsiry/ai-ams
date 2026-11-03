import { SubNav } from "@/components/subnav";
import { can, currentUser } from "@/lib/user";

export default async function AccountingLayout({ children }: { children: React.ReactNode }) {
  const u = await currentUser();
  if (!can(u, "accounting.view")) return <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-900">Accounting is available to accounting, principal, admin and account manager roles.</p>;
  return (
    <div>
      <SubNav items={[{ href: "/accounting", label: "Overview" }, { href: "/accounting/receipts", label: "Receipts" }, { href: "/accounting/invoices", label: "Invoices & aging" },
        { href: "/accounting/commissions", label: "Direct bill commissions" }, { href: "/accounting/payables", label: "Carrier payables" }, { href: "/accounting/producers", label: "Producer pay" },
        { href: "/accounting/trust", label: "Trust account" }, { href: "/accounting/ledger", label: "Ledger & export" }]} />
      {children}
    </div>
  );
}
