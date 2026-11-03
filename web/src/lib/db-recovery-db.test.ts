// Dropped database connections, against the local database (docker compose up -d db). Each test kills
// real connections with pg_terminate_backend. Skipped when the database is unreachable.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { db, isConnectionError, isReadOnly, one, q, tx } from "./db";

let up = false;
const url = process.env.DATABASE_URL ?? "postgresql://ams:ams@localhost:5433/ams";
const admin = new pg.Client({ connectionString: url });
before(async () => { try { await admin.connect(); up = true; } catch { up = false; } });
after(async () => { if (up) await admin.end(); await db.end(); });

/** Kill this test process's other connections: `application_name` isn't set, so match by the probe query or idleness. */
async function kill(where: string) {
  return (await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND ${where}`)).rowCount ?? 0;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Kill a statement once it is really running, so a busy machine can't make the test miss it. */
async function killWhenRunning(like: string) {
  for (let i = 0; i < 100; i++) {
    const n = await kill(`state = 'active' AND query LIKE '${like}%'`);
    if (n) return n;
    await wait(20);
  }
  return 0;
}

test("isReadOnly: only plain reads are retried", () => {
  for (const s of ["SELECT 1", "  select * from clients", "WITH a AS (SELECT 1) SELECT * FROM a", "SHOW server_version"]) assert.equal(isReadOnly(s), true, s);
  for (const s of ["INSERT INTO t VALUES (1)", "UPDATE t SET a = 1", "DELETE FROM t", "WITH a AS (DELETE FROM t RETURNING *) SELECT * FROM a", "SELECT * FROM t FOR UPDATE", "BEGIN"]) assert.equal(isReadOnly(s), false, s);
});

test("isConnectionError: a dropped connection, not a refused statement", () => {
  for (const e of [new Error("Connection terminated unexpectedly"), new Error("Client has encountered a connection error and is not queryable"), Object.assign(new Error("x"), { code: "ECONNRESET" }), Object.assign(new Error("x"), { code: "57P01" })]) assert.equal(isConnectionError(e), true, e.message);
  for (const e of [new Error("syntax error"), Object.assign(new Error("dup"), { code: "23505" })]) assert.equal(isConnectionError(e), false, e.message);
});

test("idle connections dropping don't crash the server, and the next query works", async (t) => {
  if (!up) return t.skip("no local database");
  await Promise.all([q("SELECT pg_sleep(0.05)"), q("SELECT pg_sleep(0.05)"), q("SELECT pg_sleep(0.05)")]);   // leave several idle
  assert.ok(await kill(`state = 'idle' AND query LIKE 'SELECT pg_sleep(0.05)%'`) >= 1);
  await wait(100);
  assert.equal((await one<{ n: number }>("SELECT 1 AS n"))?.n, 1);
});

test("a read cut off mid-query is retried and succeeds", async (t) => {
  if (!up) return t.skip("no local database");
  const running = one<{ n: number }>("SELECT 7 AS n, pg_sleep(0.3)");
  assert.ok(await killWhenRunning("SELECT 7 AS n, pg_sleep") >= 1, "the running query was killed");
  assert.equal((await running)?.n, 7);
});

test("a write cut off mid-statement fails instead of risking running twice", async (t) => {
  if (!up) return t.skip("no local database");
  const outcome = db.query("DO $$ BEGIN PERFORM pg_sleep(1); END $$").then(() => null, (e: unknown) => e);
  assert.ok(await killWhenRunning("DO $$ BEGIN PERFORM pg_sleep") >= 1);
  const failure = await outcome;
  assert.ok(failure, "the statement reported a failure");
  assert.ok(isConnectionError(failure), String(failure));
});

test("a refused statement is reported straight away, not retried", async (t) => {
  if (!up) return t.skip("no local database");
  await assert.rejects(q("SELECT no_such_column FROM clients LIMIT 1"), /no_such_column/);
});

test("a transaction killed part-way reports the failure, leaves no change, and the pool still works", async (t) => {
  if (!up) return t.skip("no local database");
  await assert.rejects(tx(async (c) => {
    await c.query("CREATE TEMP TABLE db_recovery_probe (n int) ON COMMIT DROP");
    const outcome = c.query("SELECT 11 AS marker, pg_sleep(1)").then(() => null, (e: unknown) => e);
    await killWhenRunning("SELECT 11 AS marker");
    const failure = await outcome;
    if (failure) throw failure;
  }), (e) => isConnectionError(e));
  await wait(50);
  assert.equal((await tx(async (c) => one<{ n: number }>("SELECT 2 AS n", [], c)))?.n, 2);
});

test("a transaction's own error survives its rollback", async (t) => {
  if (!up) return t.skip("no local database");
  await assert.rejects(tx(async () => { throw new Error("the real reason"); }), /the real reason/);
});
