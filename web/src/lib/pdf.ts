import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { certificateWatermark, policiesNotInForce } from "./certificates";
import { one, q, type Queryable } from "./db";
import { money, todayISO } from "./format";
import { lobLabel } from "./ref";

// Generated documents, rendered on demand from the record (DOC-12): declarations summary, certificate
// of liability insurance, auto ID cards, invoice, application summary, loss run. Agency layouts, not
// ACORD forms: the ACORD forms themselves need an ACORD distribution license (MVP dependency).

type Cell = { t: string; x: number; w: number; bold?: boolean; right?: boolean };
type Agency = { name: string; address: string; phone: string; license: string };
async function agency(on?: Queryable): Promise<Agency> {
  return (await one<{ value: Agency }>("SELECT value FROM settings WHERE key = 'agency'", [], on))?.value ?? { name: "Agency", address: "", phone: "", license: "" };
}

class Doc {
  pdf!: PDFDocument; page!: PDFPage; font!: PDFFont; bold!: PDFFont; y = 0;
  static async create() { const d = new Doc(); d.pdf = await PDFDocument.create(); d.font = await d.pdf.embedFont(StandardFonts.Helvetica); d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold); d.newPage(); return d; }
  newPage() { this.page = this.pdf.addPage([612, 792]); this.y = 750; }
  ensure(h: number) { if (this.y - h < 50) this.newPage(); }
  text(t: string, o: { x?: number; size?: number; bold?: boolean; color?: [number, number, number]; advance?: boolean } = {}) {
    const size = o.size ?? 10;
    this.ensure(size + 4);
    this.page.drawText(clean(t), { x: o.x ?? 50, y: this.y, size, font: o.bold ? this.bold : this.font, color: rgb(...(o.color ?? [0.1, 0.12, 0.16])) });
    if (o.advance !== false) this.y -= size + 5;
  }
  /** Text broken into lines no wider than width; a word is only split when it is wider than the line. */
  lines(t: string, width: number, size: number, font = this.font) {
    const out: string[] = [];
    for (const para of clean(t).split("\n")) {
      let line = "";
      for (let w of para.split(" ")) {
        const next = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
        if (line) out.push(line);
        while (font.widthOfTextAtSize(w, size) > width) { let n = w.length - 1; while (n > 1 && font.widthOfTextAtSize(w.slice(0, n), size) > width) n--; out.push(w.slice(0, n)); w = w.slice(n); }
        line = w;
      }
      out.push(line);
    }
    return out;
  }
  wrap(t: string, o: { x?: number; size?: number; width?: number; bold?: boolean } = {}) {
    const size = o.size ?? 10;
    for (const line of this.lines(t, o.width ?? 512, size, o.bold ? this.bold : this.font)) this.text(line, { x: o.x, size, bold: o.bold });
  }
  /** How much height cells() will take. */
  cellsHeight(cols: Cell[], size = 9) { return Math.max(1, ...cols.map((c) => this.lines(c.t, c.w, size, c.bold ? this.bold : this.font).length)) * (size + 3) + 2; }
  /** A row of fixed-width columns that wraps where row() cuts. */
  cells(cols: Cell[], size = 9) {
    const h = this.cellsHeight(cols, size);
    this.ensure(h);
    for (const c of cols) {
      const font = c.bold ? this.bold : this.font;
      this.lines(c.t, c.w, size, font).forEach((l, i) => this.page.drawText(l, { x: c.right ? c.x + c.w - font.widthOfTextAtSize(l, size) : c.x, y: this.y - i * (size + 3), size, font, color: rgb(0.1, 0.12, 0.16) }));
    }
    this.y -= h;
  }
  rule() { this.ensure(8); this.page.drawLine({ start: { x: 50, y: this.y + 4 }, end: { x: 562, y: this.y + 4 }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) }); this.y -= 8; }
  row(cols: { t: string; x: number; bold?: boolean }[], size = 9) { this.ensure(size + 4); for (const c of cols) this.page.drawText(clean(c.t).slice(0, 80), { x: c.x, y: this.y, size, font: c.bold ? this.bold : this.font, color: rgb(0.1, 0.12, 0.16) }); this.y -= size + 5; }
  header(a: Agency, title: string, sub?: string) {
    this.page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: rgb(0.06, 0.09, 0.16) });
    this.page.drawText(clean(a.name), { x: 50, y: 768, size: 14, font: this.bold, color: rgb(1, 1, 1) });
    this.page.drawText(clean(`${a.address} · ${a.phone} · Lic. ${a.license}`), { x: 50, y: 752, size: 8, font: this.font, color: rgb(0.8, 0.84, 0.9) });
    this.y = 715; this.text(title, { size: 16, bold: true }); if (sub) this.text(sub, { size: 9, color: [0.4, 0.45, 0.52] }); this.y -= 6;
  }
  footer(note: string) { const pages = this.pdf.getPages(); pages.forEach((p, i) => p.drawText(clean(`${note} · page ${i + 1} of ${pages.length}`), { x: 50, y: 28, size: 7, font: this.font, color: rgb(0.5, 0.53, 0.58) })); }
  /** Across the middle of every page, over the content, so no page of it can pass for a live document. Call last. */
  watermark(t: string) {
    const text = clean(t), size = Math.min(64, 640 / this.bold.widthOfTextAtSize(text, 1)), half = this.bold.widthOfTextAtSize(text, size) / 2, r = Math.SQRT1_2;
    for (const p of this.pdf.getPages()) p.drawText(text, { x: 306 - half * r + size * 0.35 * r, y: 396 - half * r - size * 0.35 * r, size, font: this.bold, rotate: degrees(45), color: rgb(0.8, 0.1, 0.15), opacity: 0.28 });
  }
  async bytes() { return Buffer.from(await this.pdf.save()); }
}
const clean = (s: string) => String(s ?? "").replace(/[^\x20-\x7E\n]/g, (ch) => ({ "—": "-", "–": "-", "’": "'", "“": '"', "”": '"', "→": "->", "•": "*", "·": "-" }[ch] ?? ""));

type PolicyRow = { id: number; policy_number: string; lob: string; carrier: string; naic: string | null; effective_date: string; expiration_date: string; premium: string; bill_mode: string; client_name: string;
  address1: string | null; city: string | null; state: string | null; zip: string | null; is_admitted: boolean; status: string; description: string | null };
async function policy(id: number) {
  return one<PolicyRow>(`SELECT p.*, ca.name AS carrier, ca.naic, c.name AS client_name, c.address1, c.city, c.state, c.zip FROM policies p JOIN carriers ca ON ca.id = p.carrier_id JOIN clients c ON c.id = p.client_id WHERE p.id = $1`, [id]);
}

export async function decPage(policyId: number): Promise<Buffer> {
  const p = await policy(policyId); if (!p) throw new Error("Policy not found");
  const [a, covs, items, ints, forms] = await Promise.all([agency(),
    q<{ description: string; limit_text: string | null; deductible_text: string | null; premium: string | null }>("SELECT description, limit_text, deductible_text, premium FROM coverages WHERE policy_id = $1 ORDER BY id", [policyId]),
    q<{ kind: string; label: string }>("SELECT i.kind, i.label FROM policy_items pi JOIN insured_items i ON i.id = pi.item_id WHERE pi.policy_id = $1 ORDER BY i.kind, i.id", [policyId]),
    q<{ name: string; role: string; loan_number: string | null }>("SELECT oi.name, ai.role, ai.loan_number FROM additional_interests ai JOIN other_interests oi ON oi.id = ai.interest_id WHERE ai.policy_id = $1", [policyId]),
    q<{ form_number: string; edition: string | null; description: string | null }>("SELECT form_number, edition, description FROM policy_forms WHERE policy_id = $1", [policyId])]);
  const d = await Doc.create();
  d.header(a, `${lobLabel(p.lob)} — Declarations summary`, `Policy ${p.policy_number} · prepared ${todayISO()} from the agency record`);
  d.row([{ t: "Named insured", x: 50, bold: true }, { t: "Carrier", x: 320, bold: true }]);
  d.row([{ t: p.client_name, x: 50 }, { t: `${p.carrier}${p.naic ? ` (NAIC ${p.naic})` : ""}${p.is_admitted ? "" : " - non-admitted"}`, x: 320 }]);
  d.row([{ t: [p.address1, `${p.city ?? ""}, ${p.state ?? ""} ${p.zip ?? ""}`].filter(Boolean).join(", "), x: 50 }, { t: `Term ${p.effective_date} to ${p.expiration_date} (12:01 AM)`, x: 320 }]);
  d.row([{ t: `Total premium ${money(p.premium, true)} · ${p.bill_mode === "agency" ? "billed by agency" : "billed by carrier"}`, x: 50 }]);
  d.y -= 6; d.text("Coverages", { bold: true, size: 11 }); d.rule();
  d.row([{ t: "Coverage", x: 50, bold: true }, { t: "Limit", x: 300, bold: true }, { t: "Deductible", x: 440, bold: true }, { t: "Premium", x: 520, bold: true }]);
  for (const c of covs) d.row([{ t: c.description, x: 50 }, { t: c.limit_text ?? "", x: 300 }, { t: c.deductible_text ?? "", x: 440 }, { t: c.premium ? money(c.premium) : "", x: 520 }]);
  if (items.length) { d.y -= 6; d.text("Scheduled items", { bold: true, size: 11 }); d.rule(); for (const i of items) d.row([{ t: i.kind.replace("_", " "), x: 50 }, { t: i.label, x: 140 }]); }
  if (ints.length) { d.y -= 6; d.text("Additional interests", { bold: true, size: 11 }); d.rule(); for (const i of ints) d.row([{ t: i.role, x: 50 }, { t: i.name, x: 140 }, { t: i.loan_number ? `Loan ${i.loan_number}` : "", x: 440 }]); }
  if (forms.length) { d.y -= 6; d.text("Forms and endorsements", { bold: true, size: 11 }); d.rule(); for (const f of forms) d.row([{ t: `${f.form_number} ${f.edition ?? ""}`, x: 50 }, { t: f.description ?? "", x: 160 }]); }
  d.footer("Summary of the agency record, not the policy contract. The carrier's policy governs");
  return d.bytes();
}

const shortDate = (d: string) => { const [y, m, day] = d.split("-"); return `${m}/${day}/${y}`; };

export async function certificate(certId: number, on?: Queryable): Promise<Buffer> {
  const ce = await one<{ cert_number: string; client_id: number; client_name: string; address1: string | null; city: string | null; state: string | null; zip: string | null; holder: string | null;
    h_attention: string | null; h_address: string | null; h_city: string | null; h_state: string | null; h_zip: string | null; description_of_operations: string | null; additional_insured: boolean;
    waiver_of_subrogation: boolean; primary_noncontributory: boolean; issued_at: Date | null; issued_by: string | null; status: string }>(
    `SELECT ce.*, c.name AS client_name, c.address1, c.city, c.state, c.zip, oi.name AS holder, oi.attention AS h_attention, oi.address1 AS h_address, oi.city AS h_city, oi.state AS h_state, oi.zip AS h_zip, u.full_name AS issued_by
       FROM certificates ce JOIN clients c ON c.id = ce.client_id LEFT JOIN other_interests oi ON oi.id = ce.holder_id LEFT JOIN users u ON u.id = ce.issued_by_id WHERE ce.id = $1`, [certId], on);
  if (!ce) throw new Error("Certificate not found");
  const pols = await q<{ id: number; policy_number: string; lob: string; carrier: string; naic: string | null; effective_date: string; expiration_date: string }>(
    `SELECT p.id, p.policy_number, p.lob, ca.name AS carrier, ca.naic, p.effective_date, p.expiration_date FROM certificate_policies cp JOIN policies p ON p.id = cp.policy_id JOIN carriers ca ON ca.id = p.carrier_id WHERE cp.certificate_id = $1 ORDER BY p.lob`, [certId], on);
  const covs = await q<{ policy_id: number; description: string; limit_text: string | null }>("SELECT policy_id, description, limit_text FROM coverages WHERE policy_id = ANY($1) ORDER BY id", [pols.map((p) => p.id)], on);
  const a = await agency(on);
  const d = await Doc.create();
  d.header(a, "Certificate of Liability Insurance", `${ce.cert_number} · issued ${ce.issued_at ? todayISO(new Date(ce.issued_at)) : "(draft)"}${ce.status !== "issued" ? ` · ${ce.status.toUpperCase()}` : ""}`);
  const lapsed = ce.status === "issued" ? await policiesNotInForce(certId, on) : [];
  if (lapsed.length) { d.wrap(`COVERAGE NO LONGER IN FORCE: ${lapsed.join(", ")}`, { bold: true, size: 10 }); d.y -= 2; }
  d.wrap("This certificate is issued as a matter of information only and confers no rights upon the certificate holder. It does not amend, extend or alter the coverage afforded by the policies below.", { size: 8 });
  d.y -= 4;
  d.cells([{ t: "Insured", x: 50, w: 260, bold: true }, { t: "Producer", x: 320, w: 242, bold: true }]);
  d.cells([{ t: ce.client_name, x: 50, w: 260 }, { t: a.name, x: 320, w: 242 }]);
  d.cells([{ t: [ce.address1, `${ce.city ?? ""}, ${ce.state ?? ""} ${ce.zip ?? ""}`].filter(Boolean).join(", "), x: 50, w: 260 }, { t: a.phone, x: 320, w: 242 }]);
  d.y -= 6; d.text("Coverages", { bold: true, size: 11 }); d.rule();
  d.cells([{ t: "Type", x: 50, w: 84, bold: true }, { t: "Insurer / policy", x: 138, w: 134, bold: true }, { t: "Effective", x: 276, w: 46, bold: true }, { t: "Expires", x: 324, w: 46, bold: true }, { t: "Limits", x: 374, w: 188, bold: true }], 8);
  for (const p of pols) {
    // Liability limits first: a certificate of liability insurance leads with occurrence/aggregate, CSL, employers liability.
    const rank = (d: string) => /each occurrence|occurrence \/ aggregate|combined single|umbrella|each claim|aggregate/i.test(d) ? 0 : /liability|statutory|part one|part two/i.test(d) ? 1 : 2;
    const lim = covs.filter((c) => c.policy_id === p.id && c.limit_text).sort((x, y) => rank(x.description) - rank(y.description)).slice(0, 4);
    const left: Cell[] = [{ t: lobLabel(p.lob), x: 50, w: 84, bold: true }, { t: `${p.carrier}\n${p.policy_number}${p.naic ? ` · NAIC ${p.naic}` : ""}`, x: 138, w: 134 }, { t: shortDate(p.effective_date), x: 276, w: 46 }, { t: shortDate(p.expiration_date), x: 324, w: 46 }];
    const limits: Cell[][] = lim.length ? lim.map((l) => [{ t: l.description, x: 374, w: 94 }, { t: l.limit_text!, x: 472, w: 90, right: true }]) : [[{ t: "See policy", x: 374, w: 188 }]];
    d.ensure(Math.max(d.cellsHeight(left, 8), limits.reduce((h, r) => h + d.cellsHeight(r, 8), 0)));
    const top = d.y;
    d.cells(left, 8);
    const low = d.y;
    d.y = top;
    for (const r of limits) d.cells(r, 8);
    d.y = Math.min(low, d.y) - 2; d.rule();
  }
  d.y -= 6; d.text("Description of operations / locations / vehicles", { bold: true, size: 11 }); d.rule();
  const wording = [ce.description_of_operations, ce.additional_insured ? "The certificate holder is included as an additional insured where required by written contract." : "",
    ce.waiver_of_subrogation ? "Waiver of subrogation applies in favor of the certificate holder where required by written contract." : "",
    ce.primary_noncontributory ? "Coverage is primary and non-contributory where required by written contract." : ""].filter(Boolean).join(" ");
  d.wrap(wording || "—", { size: 9 });
  d.y -= 6; d.text("Certificate holder", { bold: true, size: 11 }); d.rule();
  for (const l of [ce.holder ?? "", ce.h_attention ? `Attn: ${ce.h_attention}` : "", ce.h_address ?? "", ce.h_city ? `${ce.h_city}, ${ce.h_state ?? ""} ${ce.h_zip ?? ""}` : ""].filter(Boolean)) d.wrap(l, { size: 10 });
  d.y -= 4; d.wrap("Should any of the above policies be cancelled before the expiration date, notice will be given in accordance with the policy provisions.", { size: 8 });
  d.y -= 10; d.text(`Authorized representative: ${ce.issued_by ?? a.name}`, { size: 9 });
  d.footer("Agency certificate layout. ACORD 25 output requires an ACORD forms license");
  const mark = certificateWatermark(ce.status);
  if (mark) d.watermark(mark);
  return d.bytes();
}

/** The name a document downloads under, so a folder of them can be told apart without opening each one (UX-031). */
export type RenderKind = "dec_page" | "id_card" | "certificate" | "invoice";
const fileName = (...parts: (string | null | undefined)[]) => `${parts.filter(Boolean).join(" - ").replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim().slice(0, 150).trim()}.pdf`;
export async function documentFilename(kind: RenderKind, id: number, on?: Queryable): Promise<string> {
  if (kind === "certificate") {
    const c = await one<{ cert_number: string; client: string; holder: string | null }>("SELECT ce.cert_number, c.name AS client, oi.name AS holder FROM certificates ce JOIN clients c ON c.id = ce.client_id LEFT JOIN other_interests oi ON oi.id = ce.holder_id WHERE ce.id = $1", [id], on);
    return fileName(c?.cert_number ?? "Certificate", c?.client, c?.holder);
  }
  if (kind === "invoice") {
    const i = await one<{ invoice_number: string; client: string }>("SELECT i.invoice_number, c.name AS client FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = $1", [id], on);
    return fileName(`Invoice ${i?.invoice_number ?? ""}`, i?.client);
  }
  const p = await one<{ policy_number: string; client: string }>("SELECT p.policy_number, c.name AS client FROM policies p JOIN clients c ON c.id = p.client_id WHERE p.id = $1", [id], on);
  return fileName(kind === "id_card" ? "ID cards" : "Declarations", p?.policy_number, p?.client);
}

export async function idCards(policyId: number): Promise<Buffer> {
  const p = await policy(policyId); if (!p) throw new Error("Policy not found");
  const vehicles = await q<{ label: string; data: { vin?: string } }>("SELECT i.label, i.data FROM policy_items pi JOIN insured_items i ON i.id = pi.item_id WHERE pi.policy_id = $1 AND i.kind = 'vehicle'", [policyId]);
  const a = await agency();
  const d = await Doc.create();
  d.header(a, "Automobile insurance identification cards", `${p.client_name} · ${p.policy_number}`);
  for (const v of vehicles.length ? vehicles : [{ label: "All owned vehicles", data: {} }]) {
    d.ensure(130);
    const top = d.y;
    d.page.drawRectangle({ x: 50, y: top - 110, width: 340, height: 118, borderColor: rgb(0.3, 0.35, 0.45), borderWidth: 1 });
    d.text(`${p.state ?? ""} AUTOMOBILE INSURANCE IDENTIFICATION CARD`, { x: 60, size: 9, bold: true });
    d.text(`Company: ${p.carrier}${p.naic ? ` (NAIC ${p.naic})` : ""}`, { x: 60, size: 9 });
    d.text(`Policy: ${p.policy_number}`, { x: 60, size: 9 });
    d.text(`Effective ${p.effective_date}  Expires ${p.expiration_date}`, { x: 60, size: 9 });
    d.text(`Vehicle: ${v.label}`, { x: 60, size: 9 });
    d.text(`VIN: ${v.data?.vin ?? "-"}`, { x: 60, size: 9 });
    d.text(`Insured: ${p.client_name}`, { x: 60, size: 9 });
    d.text(`Agency: ${a.name} ${a.phone}`, { x: 60, size: 8 });
    d.y = top - 130;
  }
  d.footer("Keep in the vehicle. Generated from the agency record");
  return d.bytes();
}

export async function invoice(invoiceId: number): Promise<Buffer> {
  const i = await one<{ invoice_number: string; issue_date: string; due_date: string; total: string; status: string; memo: string | null; client_name: string; address1: string | null; city: string | null; state: string | null; zip: string | null; policy_number: string | null }>(
    `SELECT i.*, c.name AS client_name, c.address1, c.city, c.state, c.zip, p.policy_number FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN policies p ON p.id = i.policy_id WHERE i.id = $1`, [invoiceId]);
  if (!i) throw new Error("Invoice not found");
  const lines = await q<{ description: string; amount: string }>("SELECT description, amount FROM invoice_lines WHERE invoice_id = $1 ORDER BY id", [invoiceId]);
  const paid = await one<{ p: string }>("SELECT coalesce(sum(ra.amount),0)::text AS p FROM receipt_applications ra JOIN receipts r ON r.id = ra.receipt_id WHERE ra.invoice_id = $1 AND r.status = 'finalized'", [invoiceId]);
  const a = await agency();
  const d = await Doc.create();
  d.header(a, `Invoice ${i.invoice_number}`, `Issued ${i.issue_date} · due ${i.due_date} · ${i.status.toUpperCase()}`);
  d.text("Bill to", { bold: true }); d.text(i.client_name); d.text([i.address1, `${i.city ?? ""}, ${i.state ?? ""} ${i.zip ?? ""}`].filter(Boolean).join(", "));
  d.y -= 6; d.text(`${i.memo ?? ""}${i.policy_number ? ` · policy ${i.policy_number}` : ""}`, { size: 9 }); d.rule();
  for (const l of lines) d.row([{ t: l.description, x: 50 }, { t: money(l.amount, true), x: 480 }], 10);
  d.rule();
  d.row([{ t: "Total", x: 50, bold: true }, { t: money(i.total, true), x: 480, bold: true }], 10);
  d.row([{ t: "Paid", x: 50 }, { t: money(paid?.p, true), x: 480 }], 10);
  d.row([{ t: "Balance due", x: 50, bold: true }, { t: money(Number(i.total) - Number(paid?.p ?? 0), true), x: 480, bold: true }], 11);
  d.y -= 12; d.wrap(`Make checks payable to ${a.name} Premium Trust Account. Please include the invoice number.`, { size: 9 });
  d.footer("Premium is held in a segregated fiduciary trust account");
  return d.bytes();
}

export async function generic(title: string, clientId: number | null, policyId: number | null, kind: string): Promise<Buffer> {
  const a = await agency();
  const c = clientId ? await one<{ name: string }>("SELECT name FROM clients WHERE id = $1", [clientId]) : null;
  const p = policyId ? await policy(policyId) : null;
  const d = await Doc.create();
  d.header(a, title, [c?.name, p?.policy_number].filter(Boolean).join(" · "));
  if (kind === "application" && p) {
    d.text("Application summary", { bold: true, size: 11 }); d.rule();
    d.wrap(`Applicant ${p.client_name} applied for ${lobLabel(p.lob)} coverage with ${p.carrier}, effective ${p.effective_date}. Premium ${money(p.premium)}. Signed electronically by the applicant.`);
  } else if (kind === "loss_run") {
    const claims = clientId ? await q<{ claim_number: string; loss_date: string; kind: string; status: string }>("SELECT claim_number, loss_date, kind, status FROM claims WHERE client_id = $1 ORDER BY loss_date", [clientId]) : [];
    d.text("Loss history (as reported to the agency)", { bold: true, size: 11 }); d.rule();
    if (!claims.length) d.text("No losses reported in the period.");
    for (const cl of claims) d.row([{ t: cl.claim_number, x: 50 }, { t: cl.loss_date, x: 160 }, { t: cl.kind, x: 240 }, { t: cl.status, x: 500 }]);
  } else {
    d.wrap("Sample attachment generated for demonstration data. Uploaded files are stored and returned exactly as received.");
  }
  d.footer("Generated from the agency record");
  return d.bytes();
}
