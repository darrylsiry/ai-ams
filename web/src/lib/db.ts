import { Pool, types, type PoolClient, type QueryResult } from "pg";

// DATE columns come back as the 'YYYY-MM-DD' string they are, not a Date at the server's local
// midnight (which shifts a due date by a day depending on the machine's time zone).
types.setTypeParser(1082, (v: string) => v);

// One database: everything the AMS owns lives in DATABASE_URL (Fly Managed Postgres in production).
const url = process.env.DATABASE_URL ?? "postgresql://ams:ams@localhost:5433/ams";

/** A pool or a checked-out client: anything `query` can run on, so a function can join a caller's transaction. */
export type Queryable = Pick<Pool, "query">;

const g = globalThis as unknown as { __amsPool?: Pool };
// Every session works in the agency's time zone, so current_date and timestamp::date mean the agency's
// working day (UTC would roll "today" over at 8pm Eastern).
const TZ = process.env.DISPLAY_TZ || "America/New_York";
export const db: Pool = (g.__amsPool ??= createPool());

function createPool(): Pool {
  const pool = new Pool({
    connectionString: url, max: 10,
    // A network or proxy can drop a quiet connection without telling us: keep it alive, and replace it before it gets old.
    keepAlive: true, idleTimeoutMillis: 30_000, maxLifetimeSeconds: 600,
    connectionTimeoutMillis: 10_000,   // fail and retry, rather than hang a page on a database that isn't answering
  });
  // Belt and braces with migration 003 (the database default): also set it per connection.
  pool.on("connect", (c) => { c.query(`SET TIME ZONE '${TZ.replace(/'/g, "")}'`).catch(() => {}); });
  // Without this listener, a dropped idle connection is an uncaught error and takes the whole server down.
  pool.on("error", (err) => { console.error("database: an idle connection dropped; the pool will replace it:", err.message); });
  const send = pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<QueryResult>;
  pool.query = (async (sql: string, params?: unknown[]) => retrying(() => send(sql, params), isReadOnly(sql))) as unknown as Pool["query"];
  return pool;
}

const RETRY_DELAY_MS = 200;

/** The connection failed, as opposed to the database refusing the statement. */
export function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (["57P01", "57P02", "57P03", "08000", "08003", "08006", "08001", "08004"].includes(e?.code ?? "")) return true;
  if (["ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "EAI_AGAIN"].includes(e?.code ?? "")) return true;
  return /connection terminated|connection timeout|timeout exceeded when trying to connect|encountered a connection error|not queryable|connection ended/i.test(e?.message ?? "");
}

/** The statement was never delivered, so it can't have changed anything and any statement may go again. */
function neverSent(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "ECONNREFUSED" || /timeout exceeded when trying to connect|encountered a connection error|not queryable/i.test(e?.message ?? "");
}

/** Safe to run twice: it reads, and has no writing clause. A write may have landed before the connection dropped. */
export function isReadOnly(sql: string): boolean {
  return /^\s*(SELECT|WITH|SHOW)\b/i.test(sql) && !/\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|FOR\s+(NO\s+KEY\s+)?UPDATE|FOR\s+(KEY\s+)?SHARE)\b/i.test(sql);
}

/** One more try after a dropped connection, when that can't apply a change twice. */
async function retrying<T>(run: () => Promise<T>, readOnly: boolean): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isConnectionError(err) || !(readOnly || neverSent(err))) throw err;
    console.error("database: connection dropped, trying again:", (err as Error).message);
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return run();
  }
}

/** Run `fn` inside one transaction; it commits when `fn` resolves and rolls back when it throws. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  // Getting a working connection and BEGIN change nothing, so they can be retried. The work inside can't be.
  const c = await retrying(async () => {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      return client;
    } catch (err) {
      client.release(true);
      throw Object.assign(err as Error, { message: `connection terminated: ${(err as Error).message}` });
    }
  }, true);
  // While checked out, a dropped connection has no listener of the pool's: without this one it would crash the server.
  const dropped = (err: Error) => { console.error("database: a connection dropped during a transaction:", err.message); };
  c.on("error", dropped);
  let broken = false;
  try {
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    broken = isConnectionError(err);
    // A failed ROLLBACK means the connection is gone, and the database undoes the work itself. The caller needs the original error.
    await c.query("ROLLBACK").catch(() => { broken = true; });
    throw err;
  } finally {
    c.off("error", dropped);
    c.release(broken);
  }
}

/** Rows of a query, typed. */
export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = [], on: Queryable = db): Promise<T[]> {
  return (await on.query(sql, params)).rows as T[];
}

/** First row or null. */
export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = [], on: Queryable = db): Promise<T | null> {
  return ((await on.query(sql, params)).rows[0] as T) ?? null;
}

/** Next number in the shared document sequence, e.g. nextNumber("INV") -> "INV-26-001234". */
export async function nextNumber(prefix: string, on: Queryable = db): Promise<string> {
  const r = await one<{ n: string }>("SELECT nextval('doc_numbers')::text AS n", [], on);
  return `${prefix}-${new Date().getFullYear().toString().slice(2)}-${r!.n.padStart(6, "0")}`;
}
