import { audit } from "./audit";
import { flagCertificates } from "./certificates";
import { db, one, q, tx, type Queryable } from "./db";
import { addDays, todayISO } from "./format";
import { finalizeCancellation } from "./policies";
import { DEFAULTS, getSetting } from "./settings";
import { createActivity, remindOpenNonpay } from "./work";

// Daily automation (REN-02, PLC-51, POL-50, BIL-32, CMP-01, CLM-07). Creates the work nobody should
// have to remember to create. Every task carries an auto_key, so running twice a day, or after a
// restart, never duplicates anything. On Fly the machine sleeps when idle, so this runs on the first
// page view of the day (ensureDailyAutomation) and from POST /api/cron/daily for an external
// scheduler.

type Lead = { personal: number; commercial_small: number; commercial_large: number; large_premium: number };

export type AutomationResult = { ranOn: string; created: Record<string, number>; expired: number; cancelled: number };

export function pastDueInvoices(today: string, days: number, on: Queryable = db) {
  return q<{ id: number; invoice_number: string; client_id: number; policy_id: number | null; owner: number | null; client: string; due_date: string }>(
    `SELECT i.id, i.invoice_number, i.client_id, i.policy_id, c.account_manager_id AS owner, c.name AS client, i.due_date
       FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.status IN ('open','partial') AND i.total > 0 AND i.due_date < $1::date - $2::int`, [today, days], on);
}

/** Pending cancellations coming up: a non-pay task on each policy, or a note on the one already open (UX-003). Returns how many it created. */
export async function pendingCancellationTasks(today: string, days: number, actor: string, on: Queryable = db): Promise<number> {
  const pend = await q<{ id: number; client_id: number; policy_number: string; owner: number | null; client: string; cancel_date: string }>(
    `SELECT p.id, p.client_id, p.policy_number, p.account_manager_id AS owner, c.name AS client, p.cancel_date
       FROM policies p JOIN clients c ON c.id = p.client_id WHERE p.status = 'pending_cancel' AND p.cancel_date BETWEEN $1::date AND $1::date + $2::int`, [today, days], on);
  let made = 0;
  for (const p of pend) {
    if (await remindOpenNonpay(p.id, p.cancel_date, today, actor, on)) continue;
    if (await createActivity({ code: "NONPAY", subject: `${p.client} ${p.policy_number} cancels ${p.cancel_date} unless paid`,
      ownerId: p.owner, clientId: p.client_id, policyId: p.id, dueDate: today, source: "automation", autoKey: `pendcancel:${p.id}:${p.cancel_date}`, actor }, on)) made++;
  }
  return made;
}

export async function runDailyAutomation(today = todayISO()): Promise<AutomationResult> {
  const lead = ((await one<{ value: Lead }>("SELECT value FROM settings WHERE key = 'renewal_lead_days'"))?.value) ??
    { personal: 45, commercial_small: 90, commercial_large: 120, large_premium: 25000 };
  const windows = await getSetting("automation_windows", DEFAULTS.automation_windows);
  const created: Record<string, number> = {};
  const add = (k: string, id: number | null) => { if (id) created[k] = (created[k] ?? 0) + 1; };
  const actor = "automation";

  // 1. Renewal kickoff at each line's lead time.
  const due = await q<{ id: number; client_id: number; policy_number: string; owner: number | null; lob: string; client: string; expiration_date: string }>(
    `SELECT p.id, p.client_id, p.policy_number, coalesce(p.renewal_owner_id, p.account_manager_id) AS owner, p.lob, c.name AS client, p.expiration_date
       FROM policies p JOIN clients c ON c.id = p.client_id
      WHERE p.status = 'active' AND p.renewal_policy_id IS NULL AND p.renewal_stage = 'not_started'
        AND p.expiration_date BETWEEN $1::date AND $1::date + CASE
              WHEN p.business_type = 'personal' THEN $2::int
              WHEN p.premium >= $5 THEN $4::int ELSE $3::int END`,
    [today, lead.personal, lead.commercial_small, lead.commercial_large, lead.large_premium]);
  for (const p of due) {
    add("Renewal reviews", await createActivity({ code: "REN-REVIEW", subject: `Renewal review: ${p.client} ${p.lob} ${p.policy_number}`,
      description: `Expires ${p.expiration_date}. Review coverage, claims and pricing; decide whether to renew as-is or remarket.`,
      ownerId: p.owner, clientId: p.client_id, policyId: p.id, source: "automation", autoKey: `ren-review:${p.id}`, actor }));
  }

  // 2. Renewals a week from expiring with nothing renewed.
  const late = await q<{ id: number; client_id: number; policy_number: string; owner: number | null; client: string; expiration_date: string }>(
    `SELECT p.id, p.client_id, p.policy_number, coalesce(p.renewal_owner_id, p.account_manager_id) AS owner, c.name AS client, p.expiration_date
       FROM policies p JOIN clients c ON c.id = p.client_id
      WHERE p.status = 'active' AND p.renewal_policy_id IS NULL AND p.renewal_stage NOT IN ('renewed','lost','non_renewed')
        AND p.expiration_date BETWEEN $1::date AND $1::date + 7`, [today]);
  for (const p of late) {
    add("Renewals at risk", await createActivity({ code: "REN-PROC", priority: "high", subject: `Renewal not processed: ${p.client} ${p.policy_number} expires ${p.expiration_date}`,
      ownerId: p.owner, clientId: p.client_id, policyId: p.id, dueDate: today, source: "automation", autoKey: `ren-late:${p.id}`, actor }));
  }

  // 3. Binders about to lapse.
  const binders = await q<{ id: number; client_id: number; binder_number: string | null; owner: number | null; client: string; binder_expires: string }>(
    `SELECT p.id, p.client_id, p.binder_number, p.account_manager_id AS owner, c.name AS client, p.binder_expires
       FROM policies p JOIN clients c ON c.id = p.client_id WHERE p.status = 'bound' AND p.binder_expires <= $1::date + $2::int`, [today, windows.binder_days]);
  for (const b of binders) {
    add("Binders expiring", await createActivity({ code: "BINDER-EXP", subject: `Binder ${b.binder_number ?? ""} for ${b.client} expires ${b.binder_expires}`.replace(/\s+/g, " "),
      ownerId: b.owner, clientId: b.client_id, policyId: b.id, dueDate: b.binder_expires < today ? today : b.binder_expires, source: "automation", autoKey: `binder:${b.id}:${b.binder_expires}`, actor }));
  }

  // 4. Pending cancellations coming up.
  const pending = await pendingCancellationTasks(today, windows.pending_cancel_days, actor);
  if (pending) created["Pending cancellations"] = pending;

  // 5. Terms past expiration: renewed ones expire; pending cancellations past their date cancel.
  const exp = await db.query<{ id: number; renewal_policy_id: number | null }>(
    `UPDATE policies SET status = CASE WHEN renewal_policy_id IS NOT NULL THEN 'expired'
                                       WHEN renewal_stage = 'lost' THEN 'lost'
                                       WHEN renewal_stage = 'non_renewed' THEN 'non_renewed' ELSE 'expired' END, updated_at = now()
      WHERE status = 'active' AND expiration_date < $1::date RETURNING id, renewal_policy_id`, [today]);
  for (const p of exp.rows) if (!p.renewal_policy_id) await flagCertificates(p.id, "expired", actor, db);
  // Each notice past its date becomes a real cancellation: transaction, return premium, finance company, audit (CR-004). One failure doesn't stop the rest.
  const lapsed = await q<{ id: number }>("SELECT id FROM policies WHERE status = 'pending_cancel' AND cancel_date < $1::date", [today]);
  let cancelled = 0;
  for (const p of lapsed) {
    try {
      await tx((c) => finalizeCancellation(p.id, { username: actor }, c));
      cancelled++;
    } catch (err) {
      console.error(`automation: policy ${p.id} not cancelled`, err);
    }
  }

  // 6. Agency-bill invoices more than 10 days past due. Credits are money the agency owes, so they never count (CR-036).
  for (const i of await pastDueInvoices(today, windows.invoice_past_due_days)) {
    add("Past-due invoices", await createActivity({ code: "BILL-INQ", priority: "high", subject: `Past-due invoice ${i.invoice_number}: ${i.client}`,
      description: `Due ${i.due_date}. Contact the insured before the carrier cancels for non-payment.`, ownerId: i.owner, clientId: i.client_id, policyId: i.policy_id,
      source: "automation", autoKey: `pastdue:${i.id}`, actor }));
  }

  // 7. Producer licenses expiring within 60 days.
  const lic = await q<{ id: number; user_id: number; state: string; expires_on: string }>(
    "SELECT id, user_id, state, expires_on FROM licenses WHERE expires_on BETWEEN $1::date AND $1::date + 60", [today]);
  for (const l of lic) {
    add("License renewals", await createActivity({ code: "LICENSE", subject: `Renew ${l.state} license (expires ${l.expires_on})`, ownerId: l.user_id,
      dueDate: addDays(l.expires_on, -14) < today ? today : addDays(l.expires_on, -14), source: "automation", autoKey: `lic:${l.id}:${l.expires_on}`, actor }));
  }

  // 8. Open claims with no follow-up in two weeks.
  const stale = await q<{ id: number; claim_number: string; client_id: number; policy_id: number | null; owner: number | null; client: string }>(
    `SELECT cl.id, cl.claim_number, cl.client_id, cl.policy_id, c.account_manager_id AS owner, c.name AS client
       FROM claims cl JOIN clients c ON c.id = cl.client_id
      WHERE cl.status = 'open' AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.claim_id = cl.id AND (a.status IN ('open','waiting') OR a.completed_at > $1::date - $2::int))`, [today, windows.claim_stale_days]);
  const week = today.slice(0, 8) + String(Math.ceil(Number(today.slice(8)) / 7));
  for (const s of stale) {
    add("Claim follow-ups", await createActivity({ code: "CLAIM-FU", subject: `Claim ${s.claim_number} status check: ${s.client}`, ownerId: s.owner, clientId: s.client_id,
      policyId: s.policy_id, claimId: s.id, source: "automation", autoKey: `claimfu:${s.id}:${week}`, actor }));
  }

  const result: AutomationResult = { ranOn: today, created, expired: exp.rowCount ?? 0, cancelled };
  await db.query(`INSERT INTO settings (key, value) VALUES ('automation_last_run', $1), ('automation_last_result', $2)
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(today), JSON.stringify(result)]);
  const total = Object.values(created).reduce((s, n) => s + n, 0);
  if (total || result.expired || cancelled) {
    await audit({ actor, action: "automation.daily", entityType: "system", entityId: today,
      summary: `Daily automation: ${total} task(s) created, ${result.expired} term(s) expired, ${cancelled} cancelled`, after: result });
  }
  return result;
}

const g = globalThis as unknown as { __amsAutomation?: Promise<unknown> | null; __amsAutomationDay?: string };

/** Run today's automation once per process per day, in the background. */
export function ensureDailyAutomation(): void {
  const today = todayISO();
  if (g.__amsAutomationDay === today || g.__amsAutomation) return;
  g.__amsAutomation = (async () => {
    try {
      const last = await one<{ value: string }>("SELECT value FROM settings WHERE key = 'automation_last_run'");
      if (last?.value !== today) await runDailyAutomation(today);
      g.__amsAutomationDay = today;
    } catch (err) {
      console.error("automation: daily run failed", err);
    } finally {
      g.__amsAutomation = null;
    }
  })();
}
