import { audit } from "@/lib/audit";
import { csvCell } from "@/lib/csv";
import { contentDisposition } from "@/lib/http";
import { myProductionMonthly } from "@/lib/producer-reports";
import * as R from "@/lib/reports";
import { can, currentUser, type Permission } from "@/lib/user";

export const dynamic = "force-dynamic";

const csv = (rows: Record<string, unknown>[]) => {
  if (!rows.length) return "no rows\n";
  const cols = Object.keys(rows[0]);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
};

// The same permission each report's page asks for (SEC-002); anything not listed is agency-wide.
const NEEDS: Record<string, Permission> = { users: "admin", signins: "admin", audit: "admin", commissions: "accounting.view" };

/** CSV for every report table: /reports/csv?r=<report>&from=&to= */
export async function GET(req: Request) {
  const u = await currentUser();
  const p = new URL(req.url).searchParams;
  const range = R.rangeFrom({ from: p.get("from") ?? undefined, to: p.get("to") ?? undefined });
  const report = p.get("r") ?? "activity";
  const data: Record<string, () => Promise<Record<string, unknown>[]>> = {
    activity: () => R.activityByUser(range), activity_types: () => R.activityByType(range), users: () => R.userSummary(range),
    signins: () => R.signinEvents(range, p.get("user") ?? undefined), audit: () => R.auditByUser(range, p.get("user") ?? undefined),
    production: () => R.productionMonthly(range), my_production: () => myProductionMonthly(u.id, range), book: () => R.bookBy("lob"), retention: () => R.retentionMonthly(range), lost: () => R.lostBusiness(range),
    commissions: () => R.commissionMonthly(range), email: () => R.emailStats(range), claims: () => R.claimsBy(range),
  };
  const fn = data[report];
  if (!fn) return new Response("Unknown report", { status: 400 });
  if (report === "my_production" ? u.role !== "producer" : !can(u, NEEDS[report] ?? "reports.all")) return new Response("Your role can't export this report.", { status: 403 });
  const rows = await fn();
  await audit({ actor: u.username, action: "report.exported", entityType: "report", entityId: report, summary: `${report} ${range.from}..${range.to} (${rows.length} rows)` });
  return new Response(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": contentDisposition(`${report}-${range.from}-to-${range.to}.csv`, "attachment"), "Cache-Control": "no-store" } });
}
