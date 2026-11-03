import path from "node:path";
import { runMigrations } from "../../scripts/migrate-core.mjs";
import { db } from "./db";

/** Apply migrations/*.sql not yet recorded. */
export async function migrate(dir = path.join(process.cwd(), "migrations")): Promise<string[]> {
  const c = await db.connect();
  try {
    return await runMigrations(c, dir);
  } finally {
    c.release();
  }
}
