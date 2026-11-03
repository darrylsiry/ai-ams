import { spawn } from "node:child_process";
import { db } from "./lib/db";
import { migrate } from "./lib/migrate";

const applied = await migrate();
if (applied.length) console.log(`migrations applied: ${applied.join(", ")}`);

// SEED_ON_EMPTY=1 (Fly and docker compose): fill an empty database with the demo agency, once.
if (process.env.SEED_ON_EMPTY === "1") {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM clients");
  if (rows[0].n === 0) {
    console.log("SEED_ON_EMPTY: seeding demo data in the background");
    const child = spawn(process.execPath, ["scripts/seed.mjs"], { stdio: "inherit", env: process.env });
    child.on("exit", (code) => console.log(`seed finished with code ${code}`));
  }
}
