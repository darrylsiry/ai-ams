"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/lib/audit";
import { one, tx } from "@/lib/db";
import { storedMime, safeLocalPath } from "@/lib/http";
import { can, currentUser, Forbidden } from "@/lib/user";

const MAX = 15 * 1024 * 1024;

/** Upload a document to a client (and optionally a policy, claim or task) (DOC-01). Stored in Postgres. */
export async function uploadDocumentAction(f: FormData) {
  const u = await currentUser();
  if (!can(u, "write") && !can(u, "accounting")) throw new Forbidden("Your role can't upload documents.");
  const file = f.get("file");
  const clientId = Number(f.get("client_id")) || null;
  const back = safeLocalPath(String(f.get("back") || (clientId ? `/clients/${clientId}?tab=documents` : "/")));
  if (!file || typeof file === "string" || file.size === 0) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Choose a file.")}`);
  if (file.size > MAX) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent("Files are limited to 15 MB.")}`);
  const data = Buffer.from(await file.arrayBuffer());
  const mime = storedMime(file.type, data);
  await tx(async (c) => {
    const fr = await one<{ id: number }>("INSERT INTO files (sha256, mime, size, data) VALUES ($1,$2,$3,$4) RETURNING id", [createHash("sha256").update(data).digest("hex"), mime, data.length, data], c);
    const d = await one<{ id: number }>(
      `INSERT INTO documents (client_id, policy_id, claim_id, activity_id, folder, title, filename, mime, size, file_id, restricted, uploaded_by_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [clientId, Number(f.get("policy_id")) || null, Number(f.get("claim_id")) || null, Number(f.get("activity_id")) || null, String(f.get("folder") || "Correspondence"),
        String(f.get("title") || "").trim() || file.name, file.name, mime, data.length, fr!.id, f.get("restricted") === "on", u.id], c);
    await audit({ actor: u.username, action: "document.uploaded", entityType: "document", entityId: d!.id, summary: `${file.name} (${Math.round(data.length / 1024)} KB)` }, c);
  });
  revalidatePath(back);
  redirect(`${back}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent("Uploaded")}`);
}
