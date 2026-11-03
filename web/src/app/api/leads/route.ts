import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { nextNumber, one, tx } from "@/lib/db";
import { requestOrigin } from "@/lib/http";
import { createActivity } from "@/lib/work";

export const dynamic = "force-dynamic";

// Public quote-request form (SAL-01 Lite): creates a prospect, a primary contact and a "new lead"
// task for the right producer. Unauthenticated by design; a honeypot field, per-address throttling
// and an hourly cap across all addresses keep the noise down (SEC-018).

const HOURLY_CAP = 30;

const recent: Map<string, number[]> = ((globalThis as unknown as { __leadHits?: Map<string, number[]> }).__leadHits ??= new Map());

export async function POST(req: Request) {
  const f = await req.formData();
  if (String(f.get("website_url") ?? "")) return NextResponse.redirect(new URL("/quote?sent=1", requestOrigin(req.headers)), 303);   // honeypot
  const ip = req.headers.get("fly-client-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  const now = Date.now(), hits = (recent.get(ip) ?? []).filter((t: number) => now - t < 3_600_000);
  if (hits.length >= 5) return new NextResponse("Too many requests — please call us.", { status: 429 });
  recent.set(ip, [...hits, now]);
  const lastHour = await one<{ n: number }>("SELECT count(*)::int AS n FROM clients WHERE source = 'Website quote form' AND created_at > now() - interval '1 hour'");
  if (lastHour!.n >= HOURLY_CAP) return new NextResponse("Too many requests — please call us.", { status: 429 });
  const s = (k: string) => String(f.get(k) ?? "").trim().slice(0, 300) || null;
  const name = s("business") ?? [s("first_name"), s("last_name")].filter(Boolean).join(" ");
  if (!name || !s("email")) return NextResponse.redirect(new URL("/quote?error=1", requestOrigin(req.headers)), 303);
  const business = !!s("business");
  await tx(async (c) => {
    const producer = await one<{ id: number; am: number | null }>(
      `SELECT (SELECT id FROM users WHERE active AND role = 'producer' ORDER BY ${business ? "commission_new_pct DESC" : "commission_new_pct ASC"}, id LIMIT 1) AS id,
              (SELECT id FROM users WHERE active AND role = 'account_manager' ORDER BY id LIMIT 1) AS am`, [], c);
    const client = await one<{ id: number }>(
      `INSERT INTO clients (code, name, kind, status, email, phone, zip, source, producer_id, account_manager_id, notes) VALUES ($1,$2,$3,'prospect',$4,$5,$6,'Website quote form',$7,$8,$9) RETURNING id`,
      [await nextNumber("WEB", c), name, business ? "business" : "individual", s("email"), s("phone"), s("zip"), producer?.id ?? null, producer?.am ?? null, s("message")], c);
    await c.query("INSERT INTO contacts (client_id, first_name, last_name, email, phone, is_primary) VALUES ($1,$2,$3,$4,$5,true)", [client!.id, s("first_name") ?? name, s("last_name") ?? "", s("email"), s("phone")]);
    await createActivity({ code: "LEAD", subject: `Website quote request: ${name}`, description: `Interested in: ${f.getAll("coverage").join(", ") || "not specified"}\n\n${s("message") ?? ""}\n\nPhone ${s("phone") ?? "—"} · ZIP ${s("zip") ?? "—"}`,
      priority: "normal", ownerId: producer?.id ?? null, clientId: client!.id, source: "lead", actor: "website" }, c);
    await audit({ actor: "website", action: "lead.received", entityType: "client", entityId: client!.id, summary: `Quote request from ${name}` }, c);
  });
  // The address the visitor used: in the standalone image `req.url` is the server's own.
  return NextResponse.redirect(new URL("/quote?sent=1", requestOrigin(req.headers)), 303);
}
