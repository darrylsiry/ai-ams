import { audit } from "./audit";
import { nextNumber, one, q, tx, type Queryable } from "./db";
import { emailEnabled } from "./email/send";
import { rejected, type Rejected } from "./form-state";
import { todayISO } from "./format";
import type { User } from "./user";
import { createActivity } from "./work";

// Certificates of insurance (CRT-01..17).

export type CertFlags = { additional_insured: boolean; waiver_of_subrogation: boolean; primary_noncontributory: boolean };

/** Not a wording warning: "issue anyway" can't override a certificate that shows no coverage (UX-010). */
export const NO_POLICIES = "No policies selected: the certificate would show no coverage. Tick at least one policy.";

/** A holder picked from the list and a new one typed in the same form: refuse rather than guess which was meant (UX-010). */
export async function holderChoiceError(holderId: number | null, newName: string, on?: Queryable): Promise<string | null> {
  if (!holderId || !newName) return null;
  const h = await one<{ name: string }>("SELECT name FROM other_interests WHERE id = $1", [holderId], on);
  return `You picked ${h?.name ?? "an existing holder"} and typed a new holder. Choose one.`;
}

/**
 * The issue form back as typed (UX-009), except that a holder already chosen or just saved stays chosen, so a retry
 * can't create it twice. `saved` is a new holder's name: the form may not have its refreshed holder list yet.
 */
export function issueRefused(f: FormData, error: string, holderId: number | null, saved?: string): Rejected {
  const state = rejected(f, error);
  if (holderId) { state.values.holder_id = String(holderId); state.values.holder_mode = "existing"; }
  if (saved) state.values.holder_saved = saved;
  return state;
}

/** What to stamp across the PDF of a certificate that isn't current; null on a current one (UX-011). */
export const certificateWatermark = (status: string): string | null => status === "issued" ? null : status === "revoked" ? "REVOKED" : `${status.toUpperCase()} — NOT VALID`;

type CertRef = { id: number; cert_number: string; issued_at: Date | null };
/** The certificate that replaced this one for the same holder, and the one that is current for them now (UX-011). */
export async function replacementOf(ce: { id: number; client_id: number; holder_id: number | null }, on?: Queryable): Promise<{ next: CertRef | null; current: CertRef | null }> {
  if (!ce.holder_id) return { next: null, current: null };
  const later = await q<CertRef & { status: string }>(
    "SELECT id, cert_number, issued_at, status FROM certificates WHERE client_id = $1 AND holder_id = $2 AND id > $3 AND status <> 'draft' ORDER BY id", [ce.client_id, ce.holder_id, ce.id], on);
  return { next: later[0] ?? null, current: later.filter((c) => c.status === "issued").at(-1) ?? null };
}

type WordingRule = { form: RegExp; name: string };
const WORDING: Record<keyof CertFlags, Record<string, WordingRule>> = {
  additional_insured: {
    GL: { form: /^CG 20 (10|26|37|38)/, name: "additional insured endorsement (CG 20 10 / 20 26 / 20 37)" },
    CA: { form: /^CA 20 48/, name: "designated insured endorsement (CA 20 48)" },
    BOP: { form: /^BP 04 (02|48|50|51)/, name: "additional insured endorsement (BP 04 48)" },
  },
  waiver_of_subrogation: {
    GL: { form: /^CG 24 04/, name: "waiver of subrogation endorsement (CG 24 04)" },
    WC: { form: /^WC 00 03 13/, name: "waiver of subrogation endorsement (WC 00 03 13)" },
    BOP: { form: /^BP 04 97/, name: "waiver of subrogation endorsement (BP 04 97)" },
  },
  primary_noncontributory: {
    GL: { form: /^CG 20 01/, name: "primary and non-contributory endorsement (CG 20 01)" },
  },
};
const ALL_WORDING: (keyof CertFlags)[] = ["additional_insured", "waiver_of_subrogation", "primary_noncontributory"];
const UNCHECKABLE: Record<string, (keyof CertFlags)[]> = { CUMB: ALL_WORDING, UMB: ALL_WORDING, BOP: ["primary_noncontributory"], CA: ["waiver_of_subrogation", "primary_noncontributory"] };
const WORDING_NAME: Record<keyof CertFlags, string> = { additional_insured: "additional insured wording", waiver_of_subrogation: "waiver of subrogation wording", primary_noncontributory: "primary and non-contributory wording" };
const LINE_NAME: Record<string, string> = { CA: "auto" };

/**
 * COI coverage verification (CRT-06): requested wording must be backed by an endorsement on the
 * policy, or the certificate promises coverage that doesn't exist (a classic E&O claim).
 */
export async function verifyWording(policyIds: number[], f: CertFlags, on?: Queryable): Promise<string[]> {
  if (!policyIds.length) return ["No policies selected: the certificate would show no coverage."];
  const pols = await q<{ id: number; lob: string; lines: string[]; policy_number: string; forms: string[] }>(
    `SELECT p.id, p.lob, p.policy_number, coalesce(array_agg(pf.form_number) FILTER (WHERE pf.form_number IS NOT NULL), '{}') AS forms,
            (SELECT coalesce(array_agg(pl.lob), '{}') FROM policy_lines pl WHERE pl.policy_id = p.id) AS lines
       FROM policies p LEFT JOIN policy_forms pf ON pf.policy_id = p.id WHERE p.id = ANY($1) GROUP BY p.id`, [policyIds], on);
  const asked = (Object.keys(WORDING) as (keyof CertFlags)[]).filter((k) => f[k]);
  const warnings: string[] = [];
  for (const p of pols) {
    for (const line of new Set([p.lob, ...p.lines])) {
      for (const flag of asked) {
        const rule = WORDING[flag][line];
        if (rule && !p.forms.some((x) => rule.form.test(x))) warnings.push(`${p.policy_number} (${LINE_NAME[line] ?? line}): no ${rule.name} on file.`);
        // A line that can carry this wording, but with no form we can check: say so rather than pass it silently (CR-050).
        else if (!rule && UNCHECKABLE[line]?.includes(flag)) warnings.push(`${p.policy_number} (${LINE_NAME[line] ?? line}): ${WORDING_NAME[flag]} can't be verified here. Confirm with the carrier.`);
      }
    }
  }
  return warnings;
}

/** Policies on a certificate that are no longer in force, as "POL-1 (cancelled)". A certificate saying otherwise is an E&O claim waiting to happen (CR-005). */
export async function policiesNotInForce(certificateId: number, on?: Queryable): Promise<string[]> {
  const rows = await q<{ policy_number: string; why: string }>(
    `SELECT p.policy_number, CASE WHEN p.status IN ('active','bound','pending_cancel') THEN 'expired' ELSE p.status END AS why
       FROM certificate_policies cp JOIN policies p ON p.id = cp.policy_id
      WHERE cp.certificate_id = $1 AND (p.status NOT IN ('active','bound','pending_cancel') OR p.expiration_date < $2::date)`, [certificateId, todayISO()], on);
  return rows.map((r) => `${r.policy_number} (${r.why.replace(/_/g, " ")})`);
}

/** A policy on current certificates has stopped being in force: someone has to tell the holders. */
export async function flagCertificates(policyId: number, why: string, actor: string, on: Queryable) {
  const certs = await one<{ n: number }>(
    "SELECT count(DISTINCT cp.certificate_id)::int AS n FROM certificate_policies cp JOIN certificates ce ON ce.id = cp.certificate_id WHERE cp.policy_id = $1 AND ce.status = 'issued'", [policyId], on);
  if (!certs!.n) return;
  const p = await one<{ policy_number: string; client_id: number; account_manager_id: number | null }>("SELECT policy_number, client_id, account_manager_id FROM policies WHERE id = $1", [policyId], on);
  await createActivity({ code: "COI-RENEW", priority: "high", subject: `Notify certificate holders: ${p!.policy_number} ${why}, ${certs!.n} certificate(s) still show it`, ownerId: p!.account_manager_id, clientId: p!.client_id, policyId,
    source: "system", autoKey: `coi-notinforce:${policyId}:${why}`, actor }, on);
}

/** deliveredTo is the address on record. delivered_at stays empty until a mail server accepts it or someone marks it sent (UX-002). */
export type IssueInput = CertFlags & { clientId: number; holderId: number; policyIds: number[]; description: string | null; deliveredTo: string | null; renewedFromId?: number | null };

export async function issueCertificate(i: IssueInput, user: Pick<User, "id" | "username">, on?: Queryable): Promise<number> {
  if (!i.policyIds.length) throw new Error(NO_POLICIES);
  const run = async (c: Queryable) => {
    const usable = await q<{ id: number }>(
      "SELECT id FROM policies WHERE id = ANY($1) AND client_id = $2 AND status IN ('active','bound','pending_cancel') AND expiration_date >= $3::date", [i.policyIds, i.clientId, todayISO()], c);
    if (usable.length !== new Set(i.policyIds).size) throw new Error("A certificate can only list this client's policies that are in force.");
    const number = (await nextNumber("COI", c));
    const holder = await one<{ name: string }>("SELECT name FROM other_interests WHERE id = $1", [i.holderId], c);
    // A new certificate to the same holder supersedes the previous one.
    await c.query("UPDATE certificates SET status = 'superseded' WHERE client_id = $1 AND holder_id = $2 AND status = 'issued'", [i.clientId, i.holderId]);
    const row = await one<{ id: number }>(
      `INSERT INTO certificates (cert_number, client_id, holder_id, status, description_of_operations, additional_insured, waiver_of_subrogation, primary_noncontributory, issued_at, issued_by_id, delivered_to, renewed_from_id)
       VALUES ($1,$2,$3,'issued',$4,$5,$6,$7,now(),$8,$9,$10) RETURNING id`,
      [number, i.clientId, i.holderId, i.description, i.additional_insured, i.waiver_of_subrogation, i.primary_noncontributory, user.id, i.deliveredTo, i.renewedFromId ?? null], c);
    for (const p of i.policyIds) await c.query("INSERT INTO certificate_policies (certificate_id, policy_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [row!.id, p]);
    await c.query(`INSERT INTO documents (client_id, certificate_id, folder, title, filename, mime, generated_kind, uploaded_by_id) VALUES ($1,$2,'Certificates',$3,$4,'application/pdf','certificate',$5)`,
      [i.clientId, row!.id, `Certificate ${number} — ${holder?.name ?? ""}`, `${number}.pdf`, user.id]);
    await audit({ actor: user.username, action: "certificate.issued", entityType: "certificate", entityId: row!.id, summary: `Issued ${number} to ${holder?.name}${i.deliveredTo ? `, holder email on record ${i.deliveredTo}` : ""}` }, c);
    return row!.id;
  };
  return on ? run(on) : tx(run);
}

/** Someone sent the PDF themselves because outbound email isn't connected. The audit event is the record of who and when (UX-002). */
export async function markCertificateSent(id: number, to: string, user: Pick<User, "username">, on?: Queryable) {
  const run = async (c: Queryable) => {
    await c.query("UPDATE certificates SET delivered_to = $2, delivered_at = now() WHERE id = $1", [id, to]);
    await audit({ actor: user.username, action: "certificate.marked_sent", entityType: "certificate", entityId: id, summary: `Marked as sent to ${to}, by hand` }, c);
  };
  return on ? run(on) : tx(run);
}

/** Bulk renewal (CRT-09): reissue every current certificate whose policies have renewed, pointing at the new terms. */
export async function renewCertificates(clientId: number, user: Pick<User, "id" | "username">, on?: Queryable): Promise<{ reissued: number; held: number }> {
  const run = async (c: Queryable) => {
    const certs = await q<{ id: number; cert_number: string; holder_id: number; description_of_operations: string | null; additional_insured: boolean; waiver_of_subrogation: boolean; primary_noncontributory: boolean; delivered_to: string | null }>(
      "SELECT * FROM certificates WHERE client_id = $1 AND status = 'issued' AND holder_id IS NOT NULL", [clientId], c);
    let n = 0, held = 0;
    for (const ce of certs) {
      const pols = await q<{ id: number; renewal_policy_id: number | null; status: string }>(
        "SELECT p.id, p.renewal_policy_id, p.status FROM certificate_policies cp JOIN policies p ON p.id = cp.policy_id WHERE cp.certificate_id = $1", [ce.id], c);
      if (!pols.some((p) => p.renewal_policy_id)) continue;
      const wanted = pols.map((p) => p.renewal_policy_id ?? p.id).filter((pid, idx, a) => a.indexOf(pid) === idx);
      // Whatever stopped being in force without a renewal drops off the reissued certificate.
      const ids = (await q<{ id: number }>("SELECT id FROM policies WHERE id = ANY($1) AND status IN ('active','bound','pending_cancel') AND expiration_date >= $2::date", [wanted, todayISO()], c)).map((p) => p.id);
      if (!ids.length) continue;
      // The new term may not carry the old term's endorsements. A person looks before this wording goes out again (CR-050).
      const warnings = await verifyWording(ids, ce, c);
      if (warnings.length) {
        await createActivity({ code: "COI-RENEW", subject: `Check wording before reissuing ${ce.cert_number}`, description: warnings.join("\n"), ownerId: (await one<{ id: number | null }>("SELECT account_manager_id AS id FROM clients WHERE id = $1", [clientId], c))?.id ?? user.id,
          createdById: user.id, clientId, certificateId: ce.id, source: "system", autoKey: `coi-wording:${ce.id}:${ids.join(",")}`, actor: user.username }, c);
        held++;
        continue;
      }
      await issueCertificate({ clientId, holderId: ce.holder_id, policyIds: ids, description: ce.description_of_operations, additional_insured: ce.additional_insured,
        waiver_of_subrogation: ce.waiver_of_subrogation, primary_noncontributory: ce.primary_noncontributory, deliveredTo: emailEnabled() ? null : ce.delivered_to, renewedFromId: ce.id }, user, c);
      n++;
    }
    return { reissued: n, held };
  };
  return on ? run(on) : tx(run);
}
