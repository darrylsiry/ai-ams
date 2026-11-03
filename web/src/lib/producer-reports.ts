// A producer's own figures (UX-034). Every query takes the producer's id and filters on it; pages pass the signed-in user's id, never one from the URL.
import { db, q, type Queryable } from "./db";
import { lobLabel } from "./ref";
import type { Range } from "./reports";

export async function myProductionMonthly(producerId: number, r: Range, on: Queryable = db) {
  return q<{ month: string; new_count: number; new_premium: string; renewal_count: number; renewal_premium: string; commission: string }>(`
    SELECT to_char(effective_date, 'YYYY-MM') AS month,
      count(*) FILTER (WHERE new_renewal = 'new')::int AS new_count, coalesce(sum(premium) FILTER (WHERE new_renewal = 'new'),0)::text AS new_premium,
      count(*) FILTER (WHERE new_renewal <> 'new')::int AS renewal_count, coalesce(sum(premium) FILTER (WHERE new_renewal <> 'new'),0)::text AS renewal_premium,
      coalesce(sum(premium * commission_pct / 100),0)::text AS commission
    FROM policies WHERE producer_id = $3 AND effective_date BETWEEN $1 AND $2 AND status <> 'quote' GROUP BY 1 ORDER BY 1`, [r.from, r.to, producerId], on);
}

export async function myProductionBy(dim: "carrier" | "lob", producerId: number, r: Range, on: Queryable = db) {
  const col = { carrier: "ca.name", lob: "p.lob" }[dim];
  const rows = await q<{ key: string; new_count: number; new_premium: string; total_premium: string; commission: string }>(`
    SELECT ${col} AS key, count(*) FILTER (WHERE p.new_renewal = 'new')::int AS new_count, coalesce(sum(p.premium) FILTER (WHERE p.new_renewal = 'new'),0)::text AS new_premium,
      coalesce(sum(p.premium),0)::text AS total_premium, coalesce(sum(p.premium * p.commission_pct / 100),0)::text AS commission
    FROM policies p JOIN carriers ca ON ca.id = p.carrier_id
    WHERE p.producer_id = $3 AND p.effective_date BETWEEN $1 AND $2 AND p.status <> 'quote' GROUP BY 1 ORDER BY sum(p.premium) DESC NULLS LAST`, [r.from, r.to, producerId], on);
  return dim === "lob" ? rows.map((x) => ({ ...x, key: lobLabel(x.key) })) : rows;
}

export async function myStatements(producerId: number, on: Queryable = db) {
  return q<{ id: number; period: string; status: string; total: string; lines: number; paid_at: Date | null; newb: string; ren: string; cb: string }>(`
    SELECT ps.id, ps.period, ps.status, ps.total::text, ps.paid_at, (SELECT count(*)::int FROM producer_statement_lines l WHERE l.statement_id = ps.id) AS lines,
           (SELECT coalesce(sum(amount),0)::text FROM producer_statement_lines l WHERE l.statement_id = ps.id AND kind = 'new') AS newb,
           (SELECT coalesce(sum(amount),0)::text FROM producer_statement_lines l WHERE l.statement_id = ps.id AND kind = 'renewal') AS ren,
           (SELECT coalesce(sum(amount),0)::text FROM producer_statement_lines l WHERE l.statement_id = ps.id AND kind = 'chargeback') AS cb
      FROM producer_statements ps WHERE ps.user_id = $1 ORDER BY ps.period DESC`, [producerId], on);
}

/** Lines of one statement, and only if it is this producer's: someone else's id returns nothing. */
export async function myStatementLines(producerId: number, statementId: number, on: Queryable = db) {
  return q<{ policy_number: string; client: string; kind: string; agency_commission: string; split_pct: string; amount: string }>(`
    SELECT p.policy_number, c.name AS client, l.kind, l.agency_commission, l.split_pct, l.amount
      FROM producer_statement_lines l JOIN producer_statements ps ON ps.id = l.statement_id JOIN policies p ON p.id = l.policy_id JOIN clients c ON c.id = p.client_id
     WHERE l.statement_id = $1 AND ps.user_id = $2 ORDER BY c.name`, [statementId, producerId], on);
}
