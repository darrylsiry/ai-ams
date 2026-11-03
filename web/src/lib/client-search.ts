import { one, q, type Queryable } from "./db";

export type ClientMatch = { id: number; name: string; code: string; city: string | null; state: string | null; status: string; balance: string | null };

/** Which clients a screen may pick from. `all` leaves out only inactive clients. */
export const CLIENT_SCOPES = {
  all: "c.status <> 'inactive'",
  insured: "c.status = 'insured'",
  business: "c.kind = 'business' AND c.status = 'insured'",
  open_balance: "EXISTS (SELECT 1 FROM invoices i WHERE i.client_id = c.id AND i.status IN ('open','partial'))",
} as const;
export type ClientScope = keyof typeof CLIENT_SCOPES;

const OPEN_BALANCE = `(SELECT coalesce(sum(i.total - coalesce((SELECT sum(ra.amount) FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = i.id AND r.status = 'finalized'), 0)), 0)::text
    FROM invoices i WHERE i.client_id = c.id AND i.status IN ('open','partial'))`;

export const CLIENT_SEARCH_MIN = 2;

/** Clients for a picker: by name, DBA, code, email, contact or policy number, best name matches first. */
export async function searchClients(term: string, opts: { scope?: ClientScope; exclude?: number | null } = {}, on?: Queryable): Promise<ClientMatch[]> {
  const scope = opts.scope ?? "all";
  const t = term.trim().toLowerCase().slice(0, 100);
  if (t.length < CLIENT_SEARCH_MIN) return [];
  return q<ClientMatch>(
    `SELECT c.id, c.name, c.code, c.city, c.state, c.status, ${scope === "open_balance" ? OPEN_BALANCE : "NULL"} AS balance
       FROM clients c
      WHERE ${CLIENT_SCOPES[scope]} AND ($2::int IS NULL OR c.id <> $2) AND (
            strpos(lower(c.name), $1) > 0 OR strpos(lower(coalesce(c.dba, '')), $1) > 0
         OR strpos(lower(c.code), $1) > 0 OR strpos(lower(coalesce(c.email, '')), $1) > 0
         OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.client_id = c.id AND (strpos(lower(ct.first_name || ' ' || ct.last_name), $1) > 0 OR strpos(lower(coalesce(ct.email, '')), $1) > 0))
         OR EXISTS (SELECT 1 FROM policies p WHERE p.client_id = c.id AND strpos(replace(lower(p.policy_number), '-', ''), nullif(replace($1, '-', ''), '')) > 0))
      ORDER BY strpos(lower(c.name), $1) = 1 DESC, strpos(lower(c.name), $1) > 0 DESC, c.status = 'insured' DESC, c.name
      LIMIT 15`, [t, opts.exclude ?? null], on);
}

/** The name a picker starts with when the page already has a client. */
export async function pickedClient(id: number | null, on?: Queryable): Promise<{ id: number; name: string } | null> {
  return id ? one<{ id: number; name: string }>("SELECT id, name FROM clients WHERE id = $1", [id], on) : null;
}

/** What merging this client into another would move, for the confirmation (UX-018). */
export async function mergeCounts(id: number, on?: Queryable) {
  return one<{ policies: number; tasks: number; invoices: number }>(
    `SELECT (SELECT count(*)::int FROM policies WHERE client_id = $1) AS policies, (SELECT count(*)::int FROM activities WHERE client_id = $1) AS tasks,
            (SELECT count(*)::int FROM invoices WHERE client_id = $1) AS invoices`, [id], on);
}
