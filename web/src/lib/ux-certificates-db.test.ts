// The certificate behaviour the UX findings changed (UX-002, UX-010, UX-011, UX-013, UX-031), against the
// local database (docker compose up -d db; npm run seed). Skipped when it is unreachable. Everything
// happens in a transaction that is rolled back.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import type { PoolClient } from "pg";
import { certificateWatermark, holderChoiceError, issueCertificate, issueRefused, markCertificateSent, NO_POLICIES, renewCertificates, replacementOf } from "./certificates";
import { db, one, q } from "./db";
import { certificate, documentFilename } from "./pdf";
import { createPolicy } from "./policies";

let up = false;
const smtp = process.env.SMTP_URL;
before(async () => { delete process.env.SMTP_URL; try { await db.query("SELECT 1 FROM certificates LIMIT 1"); up = true; } catch { up = false; } });
after(async () => { if (smtp) process.env.SMTP_URL = smtp; await db.end(); });

async function rolledBack(fn: (c: PoolClient) => Promise<void>) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await fn(c);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

const flags = { additional_insured: false, waiver_of_subrogation: false, primary_noncontributory: false };

/** A fresh in-force policy and a fresh holder on a business client. */
async function setup(c: PoolClient, effectiveDate = "2031-01-01") {
  const client = (await one<{ id: number; name: string }>("SELECT id, name FROM clients WHERE kind = 'business' ORDER BY id LIMIT 1", [], c))!;
  const carrier = (await one<{ id: number }>("SELECT id FROM carriers WHERE kind = 'carrier' AND active ORDER BY id LIMIT 1", [], c))!;
  const user = (await one<{ id: number; username: string }>("SELECT id, username FROM users ORDER BY id LIMIT 1", [], c))!;
  const policyId = await createPolicy({ clientId: client.id, policyNumber: `TEST-${crypto.randomUUID().slice(0, 8)}`, carrierId: carrier.id, lob: "GL", lines: ["GL"], effectiveDate, termMonths: 12, premium: 0, commissionPct: 10,
    billMode: "agency", isAdmitted: true, paymentPlan: "annual", status: "active", producerId: user.id }, user, c);
  const holder = (await one<{ id: number; name: string }>("INSERT INTO other_interests (name, kind) VALUES ($1,'certificate_holder') RETURNING id, name", [`Test: Holder/${crypto.randomUUID().slice(0, 6)}`], c))!;
  return { client, policyId, holder, user };
}
type Setup = Awaited<ReturnType<typeof setup>>;
const issue = (s: Setup, c: PoolClient, more: { description?: string; deliveredTo?: string | null } = {}) =>
  issueCertificate({ ...flags, clientId: s.client.id, holderId: s.holder.id, policyIds: [s.policyId], description: more.description ?? null, deliveredTo: more.deliveredTo ?? null }, s.user, c);
const row = (id: number, c: PoolClient) => one<{ status: string; delivered_to: string | null; delivered_at: Date | null }>("SELECT status, delivered_to, delivered_at FROM certificates WHERE id = $1", [id], c);
const history = (id: number, c: PoolClient) => q<{ action: string; actor: string; summary: string; occurred_at: Date }>("SELECT action, actor, summary, occurred_at FROM audit_events WHERE entity_type = 'certificate' AND entity_id = $1", [String(id)], c);

/** The text drawn on each page of a PDF. */
async function pagesText(pdf: Buffer): Promise<string[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((p) => {
    const contents = p.node.Contents()!;
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    return streams.map((st) => Buffer.from(st instanceof PDFRawStream ? decodePDFRawStream(st).decode() : (st as unknown as { getContents(): Uint8Array }).getContents()).toString("latin1"))
      .join("\n").match(/<[0-9A-Fa-f]+>\s*Tj/g)?.map((h) => Buffer.from(h.replace(/[<>\sTj]/g, ""), "hex").toString("latin1")).join("\n") ?? "";
  });
}

test("UX-002: issuing without email keeps the address on record and records no delivery", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const s = await setup(c);
    const id = await issue(s, c, { deliveredTo: "pm@holder.example" });
    const ce = await row(id, c);
    assert.equal(ce!.delivered_to, "pm@holder.example");
    assert.equal(ce!.delivered_at, null);
    assert.ok(!(await history(id, c)).some((h) => /delivered/i.test(h.summary)), "the history doesn't claim a delivery");
  });
});

test("UX-002: bulk reissue without email carries the address, not a delivery", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const s = await setup(c);
    const old = await issue(s, c, { deliveredTo: "pm@holder.example" });
    await markCertificateSent(old, "pm@holder.example", s.user, c);
    const renewal = await setup(c, "2032-01-01");
    await c.query("UPDATE policies SET client_id = $2 WHERE id = $1", [renewal.policyId, s.client.id]);
    await c.query("UPDATE policies SET renewal_policy_id = $2 WHERE id = $1", [s.policyId, renewal.policyId]);
    assert.ok((await renewCertificates(s.client.id, s.user, c)).reissued >= 1);
    const fresh = (await one<{ id: number }>("SELECT id FROM certificates WHERE renewed_from_id = $1", [old], c))!.id;
    const ce = await row(fresh, c);
    assert.equal(ce!.delivered_to, "pm@holder.example");
    assert.equal(ce!.delivered_at, null);
    assert.ok(!(await history(fresh, c)).some((h) => /delivered/i.test(h.summary)));
  });
});

test("UX-002: Mark as sent records who and when, in the audit trail", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const s = await setup(c);
    const id = await issue(s, c);
    await markCertificateSent(id, "pm@holder.example", s.user, c);
    const ce = await row(id, c);
    assert.equal(ce!.delivered_to, "pm@holder.example");
    assert.ok(ce!.delivered_at);
    const mark = (await history(id, c)).find((h) => h.action === "certificate.marked_sent");
    assert.equal(mark?.actor, s.user.username);
    assert.ok(mark!.occurred_at);
    assert.match(mark!.summary, /Marked as sent to pm@holder\.example/);
    assert.doesNotMatch(mark!.summary, /delivered/i);
  });
});

test("UX-010: no policies is refused outright, and a picked holder plus a typed one is refused", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const s = await setup(c);
    await assert.rejects(issueCertificate({ ...flags, clientId: s.client.id, holderId: s.holder.id, policyIds: [], description: null, deliveredTo: null }, s.user, c), new RegExp(NO_POLICIES));
    assert.equal(await holderChoiceError(s.holder.id, "Crescent Realty Partners", c), `You picked ${s.holder.name} and typed a new holder. Choose one.`);
    assert.equal(await holderChoiceError(s.holder.id, "", c), null);
    assert.equal(await holderChoiceError(null, "Crescent Realty Partners", c), null);
  });
});

test("UX-011: a non-current certificate is stamped on every page, a current one on none", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const s = await setup(c);
    const description = "All operations of the named insured. ".repeat(500);
    const first = await issue(s, c, { description });
    const live = await pagesText(await certificate(first, c));
    assert.ok(live.length > 1, "the long description runs onto a second page");
    assert.ok(live.every((p) => !/NOT VALID|REVOKED/.test(p)));

    const second = await issue(s, c, { description });
    assert.equal((await row(first, c))!.status, "superseded");
    const old = await pagesText(await certificate(first, c));
    assert.ok(old.length > 1);
    assert.ok(old.every((p) => p.includes("SUPERSEDED - NOT VALID")), "on every page");

    await c.query("UPDATE certificates SET status = 'revoked' WHERE id = $1", [second]);
    const revoked = await pagesText(await certificate(second, c));
    assert.ok(revoked.every((p) => p.includes("REVOKED")));
    assert.equal(certificateWatermark("issued"), null);
  });
});

test("UX-011: a superseded certificate finds its replacement and the current one", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const s = await setup(c);
    const a = await issue(s, c), b = await issue(s, c), d = await issue(s, c);
    const ref = { id: a, client_id: s.client.id, holder_id: s.holder.id };
    const { next, current } = await replacementOf(ref, c);
    assert.equal(next?.id, b);
    assert.equal(current?.id, d);
    await c.query("UPDATE certificates SET status = 'revoked' WHERE id = $1", [d]);
    assert.equal((await replacementOf(ref, c)).current, null, "nothing is current once the latest is revoked");
  });
});

test("UX-013: every limit on the PDF has its label, up to four per policy", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const s = await setup(c);
    await c.query("DELETE FROM coverages WHERE policy_id = $1", [s.policyId]);
    const limits = [["Each occurrence", "$1,000,000"], ["General aggregate", "$2,000,000"], ["Products / completed operations aggregate", "$2,000,000"], ["Medical expense", "$5,000"], ["Fire damage", "$100,000"]];
    for (const [d, l] of limits) await c.query("INSERT INTO coverages (policy_id, lob, code, description, limit_text) VALUES ($1,'GL',$2,$2,$3)", [s.policyId, d, l]);
    const text = (await pagesText(await certificate(await issue(s, c), c))).join("\n");
    assert.ok(text.includes("Each occurrence\n$1,000,000"), text);
    assert.ok(text.includes("General aggregate\n$2,000,000"));
    assert.ok(text.includes("Products / completed\noperations aggregate\n$2,000,000"), "long labels wrap instead of being cut");
    assert.ok(!text.includes("$100,000"), "at most four");
    assert.ok(/notice will be given/.test(text.replace(/\n/g, " ")));
  });
});

test("UX-031: a certificate downloads under its number, insured and holder, with unsafe characters gone", async (t) => {
  if (!up) return t.skip("no database");
  await rolledBack(async (c) => {
    const s = await setup(c);
    const id = await issue(s, c);
    const number = (await one<{ cert_number: string }>("SELECT cert_number FROM certificates WHERE id = $1", [id], c))!.cert_number;
    const name = await documentFilename("certificate", id, c);
    assert.ok(name.startsWith(`${number} - `) && name.endsWith(".pdf"), name);
    assert.ok(name.includes(s.holder.name.replace(/[:/]/g, "")));
    assert.doesNotMatch(name.slice(0, -4), /[\\/:*?"<>|]/);
    const policy = (await one<{ policy_number: string }>("SELECT policy_number FROM policies WHERE id = $1", [s.policyId], c))!.policy_number;
    assert.ok((await documentFilename("id_card", s.policyId, c)).startsWith(`ID cards - ${policy} - `));
    assert.ok((await documentFilename("dec_page", s.policyId, c)).startsWith(`Declarations - ${policy} - `));
  });
});

test("UX-009: a refused issue form keeps what was typed and ticked, with a saved holder chosen", () => {
  const f = new FormData();
  for (const [k, v] of [["client_id", "7"], ["task_id", "9"], ["holder_mode", "new"], ["holder_name", "Crescent Realty"], ["holder_city", "Cary"], ["policy_ids", "1"], ["policy_ids", "2"], ["pnc", "on"], ["description", "Job 42"], ["delivered_to", "pm@holder.example"]]) f.append(k, v);
  const refused = issueRefused(f, "Check before issuing", 55, "Crescent Realty");
  assert.equal(refused.error, "Check before issuing");
  assert.deepEqual(refused.values.policy_ids, ["1", "2"]);
  assert.equal(refused.values.description, "Job 42");
  assert.equal(refused.values.delivered_to, "pm@holder.example");
  assert.equal(refused.values.pnc, "on");
  assert.equal(refused.values.task_id, "9");
  assert.equal(refused.values.holder_id, "55", "a retry reuses the saved holder");
  assert.equal(refused.values.holder_mode, "existing");
  assert.equal(refused.values.holder_saved, "Crescent Realty");

  const none = issueRefused(f, "Choose", null);
  assert.equal(none.values.holder_mode, "new");
  assert.equal(none.values.holder_id, undefined);
});
