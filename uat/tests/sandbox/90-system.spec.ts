import { test, expect, sql, val, CRON_TOKEN, basic, todayISO } from "./fixtures";

test("/api/cron/daily: refused with no token or a wrong one, runs with the right one, and does nothing twice", async ({ anon }) => {
  expect((await anon.post("/api/cron/daily")).status()).toBe(401);
  expect((await anon.post("/api/cron/daily?token=wrong")).status()).toBe(401);
  expect((await anon.post("/api/cron/daily", { headers: { Authorization: "Bearer wrong" } })).status()).toBe(401);
  // A credit long past its date is money the agency owes: nobody gets a task to chase it.
  const credit = val(`insert into invoices (invoice_number, client_id, issue_date, due_date, total, status) select 'CRD-UAT-' || extract(epoch from now())::bigint, id, current_date - 40, current_date - 40, -10, 'open' from clients order by id limit 1 returning id`);
  expect((await anon.post(`/api/cron/daily?token=${CRON_TOKEN}`)).status(), "the right token in the URL doesn't count").toBe(401);
  const ok = await anon.post("/api/cron/daily", { headers: { Authorization: `Bearer ${CRON_TOKEN}` } });
  expect(ok.status()).toBe(200);
  const j = await ok.json();
  expect(j.ranOn).toBe(todayISO());
  expect(val(`select count(*) from activities where auto_key = 'pastdue:${credit}'`)).toBe("0");
  sql(`update invoices set status = 'void' where id = ${credit} returning id`);
  const count = val("select count(*) from activities");
  const again = await anon.post("/api/cron/daily", { headers: { Authorization: `Bearer ${CRON_TOKEN}` } });
  expect(again.status()).toBe(200);
  expect((await again.json()).created, "the second run creates nothing").toEqual({});
  expect(val("select count(*) from activities")).toBe(count);
  expect(sql("select value from settings where key = 'automation_last_run'")[0][0]).toContain(todayISO());
});

test("/api/health is behind the sign-in; /api/live is public", async ({ anon }) => {
  expect((await anon.get("/api/health")).status()).toBe(401);
  const live = await anon.get("/api/live");
  expect(live.status()).toBe(200);
  expect(await live.json()).toEqual({ ok: true });
  const health = await anon.get("/api/health", { headers: { Authorization: basic("kowens") } });
  expect(health.status()).toBe(200);
  const j = await health.json();
  expect(j).toMatchObject({ ok: true, database: "up", inbound_email: "configured" });
  expect(j.clients).toBeGreaterThan(400);
  expect(j.automation_last_run).toBe(todayISO());
});
