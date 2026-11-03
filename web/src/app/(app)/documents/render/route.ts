import { contentDisposition } from "@/lib/http";
import { certificate, decPage, documentFilename, idCards, invoice } from "@/lib/pdf";

export const dynamic = "force-dynamic";

/** Render a document straight from the record: ?kind=dec_page|id_card&policy= · certificate&certificate= · invoice&invoice= */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const kind = u.get("kind");
  try {
    if (kind !== "dec_page" && kind !== "id_card" && kind !== "certificate" && kind !== "invoice") return new Response("Unknown document kind", { status: 400 });
    const id = Number(u.get(kind === "certificate" || kind === "invoice" ? kind : "policy"));
    const body = await (kind === "dec_page" ? decPage(id) : kind === "id_card" ? idCards(id) : kind === "certificate" ? certificate(id) : invoice(id));
    const name = await documentFilename(kind, id);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition(name, "inline"), "Cache-Control": "private, no-store" } });
  } catch (err) {
    return new Response((err as Error).message, { status: 404 });
  }
}
