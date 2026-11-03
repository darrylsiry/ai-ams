import fs from "node:fs";
import path from "node:path";

/**
 * Apply migrations/*.sql not yet recorded, in filename order, each in its own transaction. The server's
 * boot and the seed both run this. A session lock makes a second process starting at the same moment
 * wait, then find the work done (CR-043).
 */
export async function runMigrations(c, dir) {
  const done = [];
  try {
    await c.query("SELECT pg_advisory_lock(hashtext('ams-migrate'))");
    await c.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const applied = new Set((await c.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
    for (const file of files) {
      if (applied.has(file)) continue;
      try {
        await c.query("BEGIN");
        await c.query(fs.readFileSync(path.join(dir, file), "utf8"));
        await c.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await c.query("COMMIT");
        done.push(file);
      } catch (err) {
        await c.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(hashtext('ams-migrate'))").catch(() => {});
  }
  return done;
}
