// The client picker's search, against the local database (docker compose up -d db; npm run seed).
// Skipped when it is unreachable. Read-only.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { searchClients } from "./client-search";
import { db, one } from "./db";

let up = false;
before(async () => { try { await db.query("SELECT 1 FROM clients LIMIT 1"); up = true; } catch { up = false; } });
after(async () => { await db.end(); });

test("too short a term searches nothing", async () => {
  assert.deepEqual(await searchClients(" a "), []);
});

test("finds by part of a name, by code, and by a policy number with or without dashes", async (t) => {
  if (!up) return t.skip("no local database");
  const p = await one<{ client_id: number; name: string; code: string; policy_number: string }>(
    "SELECT c.id AS client_id, c.name, c.code, p.policy_number FROM clients c JOIN policies p ON p.client_id = c.id WHERE c.status <> 'inactive' AND p.policy_number LIKE '%-%' ORDER BY c.id LIMIT 1");
  assert.ok(p);
  const has = async (term: string) => (await searchClients(term)).some((c) => c.id === p.client_id);
  assert.ok(await has(p.name), "full name");
  assert.ok(await has(p.code), "code");
  assert.ok(await has(p.policy_number.toLowerCase()), "policy number");
  assert.ok(await has(p.policy_number.replace(/-/g, "")), "policy number without dashes");
});

test("a screen's scope and exclusion narrow the list", async (t) => {
  if (!up) return t.skip("no local database");
  const prospect = await one<{ id: number; name: string }>("SELECT id, name FROM clients WHERE status = 'prospect' ORDER BY id LIMIT 1");
  if (prospect) {
    assert.ok((await searchClients(prospect.name)).some((c) => c.id === prospect.id));
    assert.ok(!(await searchClients(prospect.name, { scope: "insured" })).some((c) => c.id === prospect.id), "insured leaves out prospects");
  }
  const person = await one<{ id: number; name: string }>("SELECT id, name FROM clients WHERE status = 'insured' AND kind = 'individual' ORDER BY id LIMIT 1");
  assert.ok(person);
  assert.ok(!(await searchClients(person.name, { scope: "business" })).some((c) => c.id === person.id), "certificates are for businesses");
  assert.ok(!(await searchClients(person.name, { exclude: person.id })).some((c) => c.id === person.id), "merge can't pick the same client");
  const owing = await one<{ id: number; name: string }>("SELECT c.id, c.name FROM clients c JOIN invoices i ON i.client_id = c.id AND i.status IN ('open','partial') ORDER BY c.id LIMIT 1");
  if (owing) {
    const hit = (await searchClients(owing.name, { scope: "open_balance" })).find((c) => c.id === owing.id);
    assert.ok(hit?.balance !== null && hit?.balance !== undefined, "the payment screen gets a balance");
  }
});

test("the list is capped, a name match leads, and inactive clients stay out", async (t) => {
  if (!up) return t.skip("no local database");
  const rows = await searchClients("an");
  assert.ok(rows.length <= 15);
  assert.ok(rows.every((c) => c.status !== "inactive"));
  const c = await one<{ name: string }>("SELECT name FROM clients WHERE status <> 'inactive' ORDER BY id LIMIT 1");
  assert.equal((await searchClients(c!.name))[0].name, c!.name);
  assert.deepEqual(await searchClients("%%"), [], "a wildcard is plain text");
});
