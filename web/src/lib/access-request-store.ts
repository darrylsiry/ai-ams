import { db, q, type Queryable } from "./db";
import { admission, DAILY_MAIL_CAP, type AccessRequestInput } from "./access-requests";
import type { NoticeResult } from "./email/send";

// access_requests: every request from the sign-in page, kept whether or not the email went out, and the
// throttle's check, made in one step with the insert.

export type AccessRequestRow = AccessRequestInput & { id: number; created_at: Date; ip: string | null; emailed_at: Date | null; email_error: string | null };

/** Any fixed number: the one lock every request takes for its check and insert. */
const ADMISSION_LOCK = 7_260_110;

/**
 * Check the throttle and keep the request as one step. Parallel posts take turns on the lock, each one
 * counting after the last one's insert committed, so ten at once from one network keep exactly the three
 * allowed. The lock ends with the transaction, before any email goes out.
 */
export async function admitAccessRequest(r: AccessRequestInput & { ip: string | null; userAgent: string | null }, on?: Queryable): Promise<{ refused: string } | { refused: null; id: number; email: boolean }> {
  const run = async (c: Queryable) => {
    await c.query("SELECT pg_advisory_xact_lock($1)", [ADMISSION_LOCK]);
    const { rows: [recent] } = await c.query<{ addresses: (string | null)[]; emails: number }>(
      `SELECT coalesce(array_agg(ip) FILTER (WHERE created_at > now() - interval '1 hour'), '{}') AS addresses,
              count(*) FILTER (WHERE email_error IS DISTINCT FROM $1)::int AS emails
         FROM access_requests WHERE created_at > now() - interval '1 day'`, [DAILY_MAIL_CAP]);
    const { refused, email } = admission(r.ip, { addressesLastHour: recent.addresses, emailsLastDay: recent.emails });
    if (refused) return { refused };
    const { rows: [{ id }] } = await c.query<{ id: string }>(
      "INSERT INTO access_requests (name, email, company, ip, user_agent, email_error) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [r.name, r.email, r.company, r.ip, r.userAgent, email ? null : DAILY_MAIL_CAP]);
    return { refused: null, id: Number(id), email };
  };
  if (on) return run(on);
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const out = await run(c);
    await c.query(out.refused ? "ROLLBACK" : "COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

export async function recordEmailResult(id: number, result: NoticeResult, on: Queryable = db): Promise<void> {
  if (result.sent) await on.query("UPDATE access_requests SET emailed_at = now(), email_error = NULL WHERE id = $1", [id]);
  else await on.query("UPDATE access_requests SET email_error = $2 WHERE id = $1", [id, result.reason]);
}

export async function listAccessRequests(limit = 50, on: Queryable = db): Promise<AccessRequestRow[]> {
  const rows = await q<AccessRequestRow>("SELECT id, created_at, name, email, company, ip, emailed_at, email_error FROM access_requests ORDER BY created_at DESC, id DESC LIMIT $1", [limit], on);
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}
