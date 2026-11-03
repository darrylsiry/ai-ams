import { q } from "./db";
import { addDays, todayISO } from "./format";
import { lobLabel } from "./ref";

// Report datasets (RPT-01..20). Each returns plain rows; the report pages render them and the CSV
// route exports exactly the same rows, so screen and download never disagree.

export type Range = { from: string; to: string };
export function rangeFrom(sp: { from?: string; to?: string; days?: string }, defaultFrom?: string): Range {
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : todayISO();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : !sp.days && defaultFrom ? defaultFrom : addDays(to, -(Number(sp.days) || 30) + 1);
  return { from, to };
}

// ───────── Activity (WRK reporting)
export async function activityByUser(r: Range) {
  return q<{ user_id: number; user: string; role: string; created: number; completed: number; on_time: number; from_email: number; open_now: number; overdue_now: number; median_hours: string | null; notes: number }>(`
    SELECT u.id AS user_id, u.full_name AS user, u.role,
      (SELECT count(*)::int FROM activities a WHERE a.owner_id = u.id AND a.created_at::date BETWEEN $1 AND $2) AS created,
      (SELECT count(*)::int FROM activities a WHERE a.completed_by_id = u.id AND a.status = 'done' AND a.completed_at::date BETWEEN $1 AND $2) AS completed,
      (SELECT count(*)::int FROM activities a WHERE a.completed_by_id = u.id AND a.status = 'done' AND a.completed_at::date BETWEEN $1 AND $2 AND a.completed_at::date <= a.due_date) AS on_time,
      (SELECT count(*)::int FROM activities a WHERE a.completed_by_id = u.id AND a.status = 'done' AND a.completed_at::date BETWEEN $1 AND $2 AND a.source = 'email') AS from_email,
      (SELECT count(*)::int FROM activities a WHERE a.owner_id = u.id AND a.status IN ('open','waiting')) AS open_now,
      (SELECT count(*)::int FROM activities a WHERE a.owner_id = u.id AND a.status = 'open' AND a.due_date < current_date) AS overdue_now,
      (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM a.completed_at - a.created_at) / 3600))::numeric, 1)::text FROM activities a
         WHERE a.completed_by_id = u.id AND a.status = 'done' AND a.completed_at::date BETWEEN $1 AND $2) AS median_hours,
      (SELECT count(*)::int FROM activity_notes n WHERE n.author_id = u.id AND n.created_at::date BETWEEN $1 AND $2 AND n.kind <> 'system') AS notes
    FROM users u WHERE u.active ORDER BY completed DESC`, [r.from, r.to]);
}
export async function activityDaily(r: Range, userId?: number) {
  return q<{ day: string; created: number; completed: number }>(`
    SELECT d::date::text AS day,
      (SELECT count(*)::int FROM activities a WHERE a.created_at::date = d::date ${userId ? "AND a.owner_id = $3" : ""}) AS created,
      (SELECT count(*)::int FROM activities a WHERE a.status = 'done' AND a.completed_at::date = d::date ${userId ? "AND a.completed_by_id = $3" : ""}) AS completed
    FROM generate_series($1::date, $2::date, '1 day') d ORDER BY d`, userId ? [r.from, r.to, userId] : [r.from, r.to]);
}
export async function activityByType(r: Range, userId?: number) {
  return q<{ category: string; label: string; completed: number; median_hours: string | null; on_time_pct: string | null; sla_hours: number | null; sla_met_pct: string | null }>(`
    SELECT ac.category, ac.label, count(*)::int AS completed,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM a.completed_at - a.created_at) / 3600))::numeric, 1)::text AS median_hours,
      round(100.0 * count(*) FILTER (WHERE a.completed_at::date <= a.due_date) / count(*), 0)::text AS on_time_pct, ac.sla_hours,
      CASE WHEN ac.sla_hours IS NULL THEN NULL ELSE round(100.0 * count(*) FILTER (WHERE a.completed_at - a.created_at <= make_interval(hours => ac.sla_hours)) / count(*), 0)::text END AS sla_met_pct
    FROM activities a JOIN activity_codes ac ON ac.code = a.code
    WHERE a.status = 'done' AND a.completed_at::date BETWEEN $1 AND $2 ${userId ? "AND a.completed_by_id = $3" : ""}
    GROUP BY ac.category, ac.label, ac.sla_hours ORDER BY completed DESC`, userId ? [r.from, r.to, userId] : [r.from, r.to]);
}
export async function activitySources(r: Range) {
  return q<{ source: string; n: number }>("SELECT source, count(*)::int AS n FROM activities WHERE created_at::date BETWEEN $1 AND $2 GROUP BY source ORDER BY n DESC", [r.from, r.to]);
}

// ───────── Users and sign-ins
export async function userSummary(r: Range) {
  return q<{ id: number; user: string; username: string; role: string; branch: string | null; active: boolean; last_signin: Date | null; signins: number; failures: number; days_active: number; completed: number; audit_actions: number; last_active: Date | null; last_place: string | null }>(`
    SELECT u.id, u.full_name AS user, u.username, u.role, b.name AS branch, u.active, u.last_active_at AS last_active,
      (SELECT max(l.occurred_at) FROM login_events l WHERE l.username = u.username AND l.success) AS last_signin,
      (SELECT count(*)::int FROM login_events l WHERE l.username = u.username AND l.success AND l.occurred_at::date BETWEEN $1 AND $2) AS signins,
      (SELECT count(*)::int FROM login_events l WHERE l.username = u.username AND NOT l.success AND l.occurred_at::date BETWEEN $1 AND $2) AS failures,
      (SELECT count(DISTINCT l.occurred_at::date)::int FROM login_events l WHERE l.username = u.username AND l.success AND l.occurred_at::date BETWEEN $1 AND $2) AS days_active,
      (SELECT count(*)::int FROM activities a WHERE a.completed_by_id = u.id AND a.status = 'done' AND a.completed_at::date BETWEEN $1 AND $2) AS completed,
      (SELECT count(*)::int FROM audit_events e WHERE e.actor = u.username AND e.occurred_at::date BETWEEN $1 AND $2) AS audit_actions,
      (SELECT concat_ws(', ', l.geo->>'city', l.geo->>'region') FROM login_events l WHERE l.username = u.username AND l.success ORDER BY l.occurred_at DESC LIMIT 1) AS last_place
    FROM users u LEFT JOIN branches b ON b.id = u.branch_id ORDER BY u.active DESC, u.full_name`, [r.from, r.to]);
}
export async function signinDaily(r: Range) {
  return q<{ day: string; signins: number; users: number; failures: number }>(`
    SELECT d::date::text AS day, count(l.*) FILTER (WHERE l.success)::int AS signins, count(DISTINCT l.username) FILTER (WHERE l.success)::int AS users, count(l.*) FILTER (WHERE NOT l.success)::int AS failures
    FROM generate_series($1::date, $2::date, '1 day') d LEFT JOIN login_events l ON l.occurred_at::date = d::date GROUP BY d ORDER BY d`, [r.from, r.to]);
}
export async function signinEvents(r: Range, username?: string) {
  return q<{ occurred_at: Date; username: string; success: boolean; method: string; ip: string | null; place: string | null; user_agent: string | null }>(`
    SELECT occurred_at, username, success, method, ip, concat_ws(', ', geo->>'city', geo->>'region', geo->>'country_code') AS place, user_agent
    FROM login_events WHERE occurred_at::date BETWEEN $1 AND $2 ${username ? "AND username = $3" : ""} ORDER BY occurred_at DESC LIMIT 500`, username ? [r.from, r.to, username] : [r.from, r.to]);
}
export async function auditByUser(r: Range, username?: string) {
  return q<{ occurred_at: Date; actor: string; action: string; entity_type: string; entity_id: string; summary: string }>(`
    SELECT occurred_at, actor, action, entity_type, entity_id, summary FROM audit_events WHERE occurred_at::date BETWEEN $1 AND $2 ${username ? "AND actor = $3" : ""} ORDER BY id DESC LIMIT 500`,
    username ? [r.from, r.to, username] : [r.from, r.to]);
}

// ───────── Production and book
export async function productionMonthly(r: Range) {
  return q<{ month: string; new_count: number; new_premium: string; renewal_count: number; renewal_premium: string; commission: string }>(`
    SELECT to_char(effective_date, 'YYYY-MM') AS month,
      count(*) FILTER (WHERE new_renewal = 'new')::int AS new_count, coalesce(sum(premium) FILTER (WHERE new_renewal = 'new'),0)::text AS new_premium,
      count(*) FILTER (WHERE new_renewal <> 'new')::int AS renewal_count, coalesce(sum(premium) FILTER (WHERE new_renewal <> 'new'),0)::text AS renewal_premium,
      coalesce(sum(premium * commission_pct / 100),0)::text AS commission
    FROM policies WHERE effective_date BETWEEN $1 AND $2 AND status <> 'quote' GROUP BY 1 ORDER BY 1`, [r.from, r.to]);
}
export async function productionBy(dim: "producer" | "carrier" | "lob" | "branch", r: Range) {
  const col = { producer: "coalesce(u.full_name,'Unassigned')", carrier: "ca.name", lob: "p.lob", branch: "coalesce(b.name,'—')" }[dim];
  const rows = await q<{ key: string; new_count: number; new_premium: string; total_premium: string; commission: string }>(`
    SELECT ${col} AS key, count(*) FILTER (WHERE p.new_renewal = 'new')::int AS new_count, coalesce(sum(p.premium) FILTER (WHERE p.new_renewal = 'new'),0)::text AS new_premium,
      coalesce(sum(p.premium),0)::text AS total_premium, coalesce(sum(p.premium * p.commission_pct / 100),0)::text AS commission
    FROM policies p JOIN carriers ca ON ca.id = p.carrier_id JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.producer_id LEFT JOIN branches b ON b.id = c.branch_id
    WHERE p.effective_date BETWEEN $1 AND $2 AND p.status <> 'quote' GROUP BY 1 ORDER BY sum(p.premium) FILTER (WHERE p.new_renewal = 'new') DESC NULLS LAST`, [r.from, r.to]);
  return dim === "lob" ? rows.map((x) => ({ ...x, key: lobLabel(x.key) })) : rows;
}
export async function bookBy(dim: "lob" | "carrier" | "am" | "type") {
  const col = { lob: "p.lob", carrier: "ca.name", am: "coalesce(u.full_name,'Unassigned')", type: "p.business_type" }[dim];
  const rows = await q<{ key: string; policies: number; clients: number; premium: string; commission: string }>(`
    SELECT ${col} AS key, count(*)::int AS policies, count(DISTINCT p.client_id)::int AS clients, sum(p.premium)::text AS premium, sum(p.premium * p.commission_pct / 100)::text AS commission
    FROM policies p JOIN carriers ca ON ca.id = p.carrier_id LEFT JOIN users u ON u.id = p.account_manager_id WHERE p.status IN ('active','bound','pending_cancel') GROUP BY 1 ORDER BY sum(p.premium) DESC`);
  return dim === "lob" ? rows.map((x) => ({ ...x, key: lobLabel(x.key) })) : rows;
}

// ───────── Renewals and retention
export async function retentionMonthly(r: Range) {
  return q<{ month: string; expiring: number; renewed: number; lost: number; retention_pct: string | null; premium_change_pct: string | null }>(`
    SELECT to_char(p.expiration_date, 'YYYY-MM') AS month, count(*)::int AS expiring, count(*) FILTER (WHERE p.renewal_policy_id IS NOT NULL)::int AS renewed,
      count(*) FILTER (WHERE p.renewal_policy_id IS NULL AND (p.status IN ('lost','non_renewed') OR p.renewal_stage IN ('lost','non_renewed')))::int AS lost,
      round(100.0 * count(*) FILTER (WHERE p.renewal_policy_id IS NOT NULL) / nullif(count(*),0), 1)::text AS retention_pct,
      round(avg((rp.premium - p.premium) / nullif(p.premium,0) * 100) FILTER (WHERE rp.carrier_id = p.carrier_id), 1)::text AS premium_change_pct
    FROM policies p LEFT JOIN policies rp ON rp.id = p.renewal_policy_id
    WHERE p.expiration_date BETWEEN $1 AND least($2::date, current_date) AND p.status <> 'cancelled' GROUP BY 1 ORDER BY 1`, [r.from, r.to]);
}
export async function lostBusiness(r: Range) {
  return q<{ policy_id: number; policy_number: string; client: string; lob: string; premium: string; expiration_date: string; reason: string | null; am: string | null; stage: string }>(`
    SELECT p.id AS policy_id, p.policy_number, c.name AS client, p.lob, p.premium, p.expiration_date, p.remarket_reason AS reason, u.full_name AS am, p.renewal_stage AS stage
    FROM policies p JOIN clients c ON c.id = p.client_id LEFT JOIN users u ON u.id = p.account_manager_id
    WHERE p.expiration_date BETWEEN $1 AND $2 AND p.renewal_policy_id IS NULL AND (p.status IN ('lost','non_renewed') OR p.renewal_stage IN ('lost','non_renewed')) ORDER BY p.expiration_date DESC`, [r.from, r.to]);
}
export async function expirations(days: number) {
  return q<{ policy_id: number; policy_number: string; client: string; lob: string; carrier: string; premium: string; expiration_date: string; stage: string; owner: string | null }>(`
    SELECT p.id AS policy_id, p.policy_number, c.name AS client, p.lob, ca.name AS carrier, p.premium, p.expiration_date, p.renewal_stage AS stage, u.full_name AS owner
    FROM policies p JOIN clients c ON c.id = p.client_id JOIN carriers ca ON ca.id = p.carrier_id LEFT JOIN users u ON u.id = coalesce(p.renewal_owner_id, p.account_manager_id)
    WHERE p.status IN ('active','pending_cancel') AND p.renewal_policy_id IS NULL AND p.expiration_date BETWEEN current_date AND current_date + $1::int ORDER BY p.expiration_date`, [days]);
}

// ───────── Commissions
export async function commissionMonthly(r: Range) {
  return q<{ month: string; direct_bill: string; agency_bill: string; total: string }>(`
    SELECT to_char(entry_date, 'YYYY-MM') AS month,
      coalesce(sum(credit - debit) FILTER (WHERE ref_type = 'commission_statement'),0)::text AS direct_bill,
      coalesce(sum(credit - debit) FILTER (WHERE ref_type = 'invoice'),0)::text AS agency_bill,
      coalesce(sum(credit - debit),0)::text AS total
    FROM ledger_entries WHERE account = 'commission_income' AND entry_date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [r.from, r.to]);
}
export async function commissionByCarrier(r: Range) {
  return q<{ carrier: string; statements: number; received: string; expected: string; variance_lines: number }>(`
    SELECT ca.name AS carrier, count(DISTINCT cs.id)::int AS statements, coalesce(sum(cl.commission),0)::text AS received, coalesce(sum(cl.expected_commission),0)::text AS expected,
      count(*) FILTER (WHERE cl.match_status = 'variance')::int AS variance_lines
    FROM commission_statements cs JOIN carriers ca ON ca.id = cs.carrier_id JOIN commission_lines cl ON cl.statement_id = cs.id
    WHERE cs.statement_date BETWEEN $1 AND $2 GROUP BY ca.name ORDER BY sum(cl.commission) DESC`, [r.from, r.to]);
}

// ───────── Email intake
export async function emailDaily(r: Range) {
  return q<{ day: string; received: number; ai: number; matched: number }>(`
    SELECT d::date::text AS day, count(e.*)::int AS received, count(e.*) FILTER (WHERE e.classified_by = 'ai')::int AS ai, count(e.*) FILTER (WHERE e.client_id IS NOT NULL)::int AS matched
    FROM generate_series($1::date, $2::date, '1 day') d LEFT JOIN emails e ON e.received_at::date = d::date AND e.direction = 'inbound' GROUP BY d ORDER BY d`, [r.from, r.to]);
}
export async function emailStats(r: Range) {
  return q<{ user: string; received: number; forwarded: number; matched_pct: string | null; actioned: number; triage: number; median_hours_to_done: string | null }>(`
    SELECT coalesce(u.full_name, 'Unrouted') AS user, count(*)::int AS received, count(*) FILTER (WHERE e.forwarded_by_user_id IS NOT NULL)::int AS forwarded,
      round(100.0 * count(*) FILTER (WHERE e.client_id IS NOT NULL) / count(*), 0)::text AS matched_pct,
      count(*) FILTER (WHERE e.status = 'actioned')::int AS actioned, count(*) FILTER (WHERE e.status = 'new')::int AS triage,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM a.completed_at - e.received_at) / 3600) FILTER (WHERE a.completed_at IS NOT NULL))::numeric, 1)::text AS median_hours_to_done
    FROM emails e LEFT JOIN users u ON u.id = e.routed_user_id LEFT JOIN activities a ON a.id = e.activity_id
    WHERE e.direction = 'inbound' AND e.received_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY received DESC`, [r.from, r.to]);
}
export async function emailByType(r: Range) {
  return q<{ label: string; n: number }>(`SELECT coalesce(ac.label, 'No task') AS label, count(*)::int AS n FROM emails e LEFT JOIN activities a ON a.id = e.activity_id LEFT JOIN activity_codes ac ON ac.code = a.code
    WHERE e.direction = 'inbound' AND e.received_at::date BETWEEN $1 AND $2 GROUP BY 1 ORDER BY n DESC`, [r.from, r.to]);
}

// ───────── Claims
export async function claimsBy(r: Range) {
  return q<{ kind: string; reported: number; open: number; median_days_open: string | null }>(`
    SELECT kind, count(*)::int AS reported, count(*) FILTER (WHERE status = 'open')::int AS open,
      round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM coalesce(closed_at, now()) - reported_date::timestamptz) / 86400))::numeric, 0)::text AS median_days_open
    FROM claims WHERE reported_date BETWEEN $1 AND $2 GROUP BY kind ORDER BY reported DESC`, [r.from, r.to]);
}
