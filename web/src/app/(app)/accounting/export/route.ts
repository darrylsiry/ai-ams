import { ACCOUNT_LABEL, sweepable, type Account } from "@/lib/accounting";
import { q } from "@/lib/db";
import { csvCell } from "@/lib/csv";
import { contentDisposition } from "@/lib/http";
import { todayISO } from "@/lib/format";
import { can, currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

const csv = (rows: (string | number | null)[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const GL: Record<Account, string> = { trust_cash: "1010 Premium Trust Cash", operating_cash: "1000 Operating Cash", premium_receivable: "1200 Premium Receivable", commission_receivable: "1210 Commission Receivable",
  carrier_payable: "2100 Carrier Payable", tax_payable: "2150 Surplus Lines Tax Payable", refunds_payable: "2160 Client Refunds Payable", producer_payable: "2200 Producer Commission Payable",
  commission_income: "4000 Commission Income", fee_income: "4100 Agency Fee Income", producer_expense: "5000 Producer Commission Expense" };

/** GL export (GL-17): summary journal, detail CSV, QuickBooks IIF, and the trust statement. A download changes nothing; "Mark as exported" on the ledger page does (CR-016). */
export async function GET(req: Request) {
  const u = await currentUser();
  if (!can(u, "accounting.view")) return new Response("Forbidden", { status: 403 });
  const p = new URL(req.url).searchParams;
  const kind = p.get("kind") ?? "summary";
  if (!["summary", "detail", "iif", "trust"].includes(kind)) return new Response("Unknown export", { status: 400 });
  const month = p.get("month") ?? todayISO().slice(0, 7);
  let body = "", name = "", type = "text/csv; charset=utf-8";
  if (kind === "trust") {
    const s = await sweepable();
    body = csv([["Statement of premium trust", todayISO()], ["Trust cash", s.trust], ["Owed to carriers", s.carriers], ["Owed to states", s.taxes], ["Client refunds owed", s.credits], ["Total obligations", s.owed], ["Excess available", s.available]]);
    name = `premium-trust-${todayISO()}.csv`;
  } else {
    const rows = await q<{ entry_date: string; journal: string; account: Account; debit: string; credit: string; memo: string; ref_type: string | null; ref_id: number | null }>(
      "SELECT entry_date, journal, account, debit, credit, memo, ref_type, ref_id FROM ledger_entries WHERE to_char(entry_date, 'YYYY-MM') = $1 ORDER BY entry_date, id", [month]);
    if (kind === "detail") {
      body = csv([["date", "journal", "gl_account", "account", "debit", "credit", "memo", "source", "source_id"], ...rows.map((r) => [r.entry_date, r.journal, GL[r.account], ACCOUNT_LABEL[r.account], r.debit, r.credit, r.memo, r.ref_type, r.ref_id])]);
      name = `ams-journal-detail-${month}.csv`;
    } else {
      const sums = new Map<Account, { d: number; c: number }>();
      for (const r of rows) { const s = sums.get(r.account) ?? { d: 0, c: 0 }; s.d += Number(r.debit); s.c += Number(r.credit); sums.set(r.account, s); }
      const end = new Date(`${month}-01T12:00:00Z`); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
      const date = end.toISOString().slice(0, 10);
      if (kind === "iif") {
        type = "text/plain; charset=utf-8";
        const lines = ["!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO", "!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tMEMO", "!ENDTRNS"];
        let first = true;
        for (const [a, s] of sums) { const amt = (s.d - s.c).toFixed(2); lines.push(`${first ? "TRNS" : "SPL"}\tGENERAL JOURNAL\t${date.slice(5, 7)}/${date.slice(8)}/${date.slice(0, 4)}\t${GL[a]}\t${amt}\tsiryous AMS ${month}`); first = false; }
        lines.push("ENDTRNS");
        body = lines.join("\n") + "\n";
        name = `ams-journal-${month}.iif`;
      } else {
        body = csv([["date", "gl_account", "debit", "credit", "memo"], ...[...sums].map(([a, s]) => [date, GL[a], Math.max(0, s.d - s.c).toFixed(2), Math.max(0, s.c - s.d).toFixed(2), `siryous AMS ${month}`])]);
        name = `ams-journal-summary-${month}.csv`;
      }
    }
  }
  return new Response(body, { headers: { "Content-Type": type, "Content-Disposition": contentDisposition(name, "attachment"), "Cache-Control": "no-store" } });
}
