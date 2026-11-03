import { one } from "@/lib/db";
import { documentHeaders } from "@/lib/http";
import { certificate, decPage, documentFilename, generic, idCards, invoice } from "@/lib/pdf";
import { audit } from "@/lib/audit";
import { can, currentUser } from "@/lib/user";

export const dynamic = "force-dynamic";

/** Download a document: stored bytes, or the generated PDF it stands for. Restricted documents need PII access. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await one<{ id: number; title: string; filename: string; mime: string; file_id: number | null; generated_kind: string | null; restricted: boolean; client_id: number | null; policy_id: number | null; certificate_id: number | null; ref_id: number | null }>(
    "SELECT id, title, filename, mime, file_id, generated_kind, restricted, client_id, policy_id, certificate_id, ref_id FROM documents WHERE id = $1 AND active", [Number(id)]);
  if (!d) return new Response("Not found", { status: 404 });
  const u = await currentUser();
  if (d.restricted && !can(u, "pii")) return new Response("This document is restricted.", { status: 403 });
  let body: Buffer, mime = d.mime, name = d.filename;
  if (d.file_id) {
    const f = await one<{ data: Buffer; mime: string }>("SELECT data, mime FROM files WHERE id = $1", [d.file_id]);
    if (!f) return new Response("File missing", { status: 404 });
    body = f.data; mime = f.mime;
  } else {
    const k = d.generated_kind ?? "";
    body = k === "dec_page" && d.policy_id ? await decPage(d.policy_id)
      : k === "certificate" && d.certificate_id ? await certificate(d.certificate_id)
      : k === "id_card" && d.policy_id ? await idCards(d.policy_id)
      : k === "invoice" && d.ref_id ? await invoice(d.ref_id)
      : await generic(d.title.replace(/\.pdf$/i, ""), d.client_id, d.policy_id, k);
    // Past the restricted check, and only what the PDF itself prints (UX-031).
    mime = "application/pdf"; name = k === "certificate" && d.certificate_id ? await documentFilename("certificate", d.certificate_id) : name.endsWith(".pdf") ? name : `${name}.pdf`;
  }
  if (d.restricted) await audit({ actor: u.username, action: "document.viewed", entityType: "document", entityId: d.id, summary: `Viewed restricted ${d.title}` });
  return new Response(new Uint8Array(body), { headers: documentHeaders(name, mime, body) });
}
