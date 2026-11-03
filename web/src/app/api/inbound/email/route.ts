import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ingestEmail } from "@/lib/email/ingest";
import { fromGeneric, fromJson, fromRaw, parseAddressList, type ParsedEmail } from "@/lib/email/parse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Inbound email webhook (WRK-20). Point your provider's inbound route here:
//   Postmark:   https://<user>:<INBOUND_EMAIL_TOKEN>@<app>/api/inbound/email      (JSON)
//   Mailgun / SendGrid Inbound Parse:  https://<app>/api/inbound/email?token=...  (multipart form)
//   Cloudflare Email Worker / SES / anything raw: POST the RFC 822 message with Content-Type message/rfc822
// Authenticated by INBOUND_EMAIL_TOKEN (header X-Inbound-Token, Bearer, or the Basic password; ?token=
// only for providers that can't send a header, since a URL ends up in logs).
// See docs/INBOUND_EMAIL.md.

const MAX_BODY = 30 * 1024 * 1024;   // SEC-017; base64 attachments arrive about a third larger

/** The request with its body read, or null when it is over the limit (whatever Content-Length claims). */
async function bounded(req: Request): Promise<Request | null> {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = req.body?.getReader();
  for (let r = await reader?.read(); r && !r.done; r = await reader!.read()) {
    size += r.value.length;
    if (size > MAX_BODY) return null;
    chunks.push(r.value);
  }
  return new Request(req.url, { method: req.method, headers: req.headers, body: Buffer.concat(chunks) });
}

function same(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

function authorized(req: Request): boolean {
  const token = process.env.INBOUND_EMAIL_TOKEN;
  if (!token) return false;   // fail closed: no token configured, no inbound email
  const url = new URL(req.url);
  const candidates = [url.searchParams.get("token"), req.headers.get("x-inbound-token")];
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) { const d = Buffer.from(auth.slice(6), "base64").toString("utf8"); candidates.push(d.slice(d.indexOf(":") + 1)); }
  if (auth?.startsWith("Bearer ")) candidates.push(auth.slice(7));
  return candidates.some((c) => !!c && same(c, token));
}

async function parse(req: Request): Promise<ParsedEmail> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (type.includes("application/json")) return fromJson(await req.json());
  if (type.includes("multipart/form-data") || type.includes("application/x-www-form-urlencoded")) {
    const f = await req.formData();
    const raw = f.get("email");                                  // SendGrid "post the raw, full MIME message"
    if (typeof raw === "string" && raw.includes("\n")) return fromRaw(raw);
    const mime = f.get("body-mime");                             // Mailgun "store and notify" with MIME
    if (typeof mime === "string") return fromRaw(mime);
    const attachments: { filename: string; contentType: string; content: string }[] = [];
    for (const [, v] of f.entries()) {
      if (typeof v !== "string") attachments.push({ filename: v.name, contentType: v.type || "application/octet-stream", content: Buffer.from(await v.arrayBuffer()).toString("base64") });
    }
    const s = (k: string) => (f.get(k) as string | null) ?? undefined;
    // SendGrid's dkim field reads "{@example.com : pass}"; Mailgun reports the From alignment as a whole.
    const fromAddr = parseAddressList(s("from") ?? s("sender"))[0]?.addr ?? "";
    const senderVerified = (!!fromAddr && (s("dkim") ?? "").toLowerCase().includes(`@${fromAddr.split("@")[1]} : pass`)) || (s("X-Mailgun-Dkim-Check-Result") === "Pass" && s("X-Mailgun-Spf") === "Pass");
    let envelopeTo = s("recipient");                              // Mailgun
    try { const env = JSON.parse(s("envelope") ?? "null"); if (env?.to) envelopeTo = [].concat(env.to).join(", "); } catch {}   // SendGrid
    return fromGeneric({ from: s("from") ?? s("sender"), to: s("To") ?? s("to") ?? s("recipient"), envelopeTo, cc: s("Cc") ?? s("cc"), subject: s("subject"),
      text: s("body-plain") ?? s("text") ?? s("stripped-text"), html: s("body-html") ?? s("html"), messageId: s("Message-Id") ?? s("message-id"), senderVerified, attachments });
  }
  return fromRaw(Buffer.from(await req.arrayBuffer()));         // message/rfc822, text/plain, octet-stream
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await bounded(req);
  if (!body) return NextResponse.json({ error: "too large" }, { status: 413 });
  let email: ParsedEmail;
  try {
    email = await parse(body);
    // A relay that knows the envelope recipient (a Cloudflare Email Worker, SES) can pass it in a header.
    const envelope = req.headers.get("x-envelope-to");
    if (envelope) email.envelopeTo = [...parseAddressList(envelope), ...(email.envelopeTo ?? [])];
  } catch (err) {
    return NextResponse.json({ error: `could not read the email: ${(err as Error).message}` }, { status: 400 });
  }
  if (!email.from.addr || email.from.addr === "unknown@unknown") return NextResponse.json({ error: "no sender" }, { status: 422 });
  try {
    const r = await ingestEmail(email, { source: "webhook" });
    return NextResponse.json({ ok: true, email_id: r.emailId, activity_id: r.activityId, duplicate: r.duplicate, classified_by: r.classifiedBy,
      activity_code: r.classification.activity_code, routed_to: r.routedTo, client_id: r.match.clientId });
  } catch (err) {
    console.error("inbound email failed", err);
    // 5xx so the provider retries; Message-ID makes the retry idempotent.
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ endpoint: "POST inbound email here (JSON, multipart or raw MIME) with INBOUND_EMAIL_TOKEN", docs: "docs/INBOUND_EMAIL.md" });
}
