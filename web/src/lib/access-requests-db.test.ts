// The access-request store against the local database (docker compose up -d db). Skipped when it is
// unreachable. Everything happens in a transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { admitAccessRequest, listAccessRequests, recordEmailResult } from "./access-request-store";
import { DAILY_MAIL_CAP, LIMITS } from "./access-requests";
import { db } from "./db";

let up = false;
before(async () => { try { await db.query("SELECT 1 FROM access_requests LIMIT 1"); up = true; } catch { up = false; } });
after(async () => { await db.end(); });

const req = (ip: string) => ({ name: "Pat", email: "pat@x.example", company: "", ip, userAgent: "test" });

test("three an hour from one network are kept, the fourth is refused, and the email result is recorded", async (t) => {
  if (!up) return t.skip("no database");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const ip = `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const kept: Awaited<ReturnType<typeof admitAccessRequest>>[] = [];
    for (let i = 0; i < LIMITS.perAddressPerHour; i++) kept.push(await admitAccessRequest(req(ip), c));
    assert.ok(kept.every((k) => k.refused === null));
    assert.match((await admitAccessRequest(req(ip), c)).refused ?? "", /last hour/);
    const first = kept[0] as { id: number };
    await recordEmailResult(first.id, { sent: false, reason: "Email isn't set up" }, c);
    await recordEmailResult((kept[1] as { id: number }).id, { sent: true, id: "<x>" }, c);
    const rows = (await listAccessRequests(10, c)).filter((r) => r.ip === ip);
    assert.equal(rows.length, LIMITS.perAddressPerHour);
    assert.equal(rows.find((r) => r.id === first.id)!.email_error, "Email isn't set up");
    assert.ok(rows.find((r) => r.id === (kept[1] as { id: number }).id)!.emailed_at);
  } finally { await c.query("ROLLBACK"); c.release(); }
});

test("past the day's emails a request is still kept, marked as not emailed", async (t) => {
  if (!up) return t.skip("no database");
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query("INSERT INTO access_requests (name, email, ip) SELECT 'x', 'x@x.example', '198.19.' || g || '.1' FROM generate_series(1, $1) g", [LIMITS.emailsPerDay]);
    const r = await admitAccessRequest(req("198.19.250.250"), c);
    assert.equal(r.refused, null);
    assert.equal((r as { email: boolean }).email, false);
    const { rows: [row] } = await c.query("SELECT email_error FROM access_requests WHERE id = $1", [(r as { id: number }).id]);
    assert.equal(row.email_error, DAILY_MAIL_CAP);
  } finally { await c.query("ROLLBACK"); c.release(); }
});
