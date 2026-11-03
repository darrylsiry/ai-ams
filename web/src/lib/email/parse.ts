// Normalizes inbound email from any provider into one shape. Supported:
//   - Postmark inbound webhook JSON (From, FromFull, ToFull, TextBody, Attachments[].Content base64 ...)
//   - Generic JSON {from, to, cc, subject, text, html, messageId, date, attachments[{filename, contentType, content}]}
//     (what the Cloudflare Email Worker in docs/INBOUND_EMAIL.md and the in-app simulator send)
//   - Raw RFC 822 MIME (Content-Type message/rfc822, or a JSON {raw} field): Cloudflare, SES, an .eml upload
//   - Multipart form posts (Mailgun "store and notify" / SendGrid Inbound Parse): handled in the route via toGeneric()

export type Address = { addr: string; name: string | null };
export type Attachment = { filename: string; mime: string; data: Buffer };
export type ParsedEmail = {
  messageId: string | null;
  from: Address;
  to: Address[];
  /** Envelope recipients (the alias the message was delivered to), when the provider reports them.
   *  An auto-forward rule keeps the original To header, so routing looks here first. */
  envelopeTo?: Address[];
  cc: Address[];
  subject: string;
  text: string;
  html: string | null;
  date: Date;
  attachments: Attachment[];
  /** The provider's SPF or DKIM result shows the From domain is genuine (SEC-008). The From header alone proves nothing. */
  senderVerified?: boolean;
};

const MAX_ATTACHMENTS = 20;
const cap = (list: Attachment[]) => list.filter((a) => a.data.length <= MAX_ATTACHMENT).slice(0, MAX_ATTACHMENTS);

const sameDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

const authservId = (header: string) => /^\s*(?:\([^)]*\)\s*)?([^\s;]+)/.exec(header)?.[1]?.toLowerCase();

/**
 * Whether the receiving provider's own checks vouch for the From domain. Anyone can write these headers
 * into a message, so an Authentication-Results counts only when it names the provider's server
 * (INBOUND_AUTHSERV_ID), and Received-SPF only for a provider known to always add its own on top
 * (INBOUND_TRUST_RECEIVED_SPF=1). With neither set, nothing is verified (SEC-008).
 */
export function senderAuthenticated(authResults: string | string[] | undefined, receivedSpf: string | undefined, from: string, env: Record<string, string | undefined> = process.env): boolean {
  const domain = from.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  const trusted = env.INBOUND_AUTHSERV_ID?.trim().toLowerCase();
  const own = trusted ? [authResults ?? []].flat().find((h) => authservId(h) === trusted) : undefined;
  const auth = (own ?? "").toLowerCase();
  for (const m of auth.matchAll(/\b(?:dkim|dmarc)=pass\b[^;]*?header\.(?:d|from|i)=@?([^\s;]+)/g)) if (sameDomain(m[1], domain)) return true;
  for (const m of auth.matchAll(/\bspf=pass\b[^;]*?smtp\.mailfrom=(?:[^\s;@]+@)?([^\s;]+)/g)) if (sameDomain(m[1], domain)) return true;
  const spf = (env.INBOUND_TRUST_RECEIVED_SPF === "1" ? receivedSpf ?? "" : "").toLowerCase();
  if (/^\s*pass\b/.test(spf)) {
    const who = /envelope-from="?(?:[^\s"@;]+@)?([^\s";]+)/.exec(spf)?.[1] ?? /domain of (?:[^\s@]+@)?([^\s]+)/.exec(spf)?.[1];
    if (who && sameDomain(who, domain)) return true;
  }
  return false;
}

const ADDR_RE = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/;

/** "Jane Doe <jane@x.com>" | "jane@x.com" -> Address. */
export function parseAddress(s: string): Address | null {
  const t = s.trim();
  if (!t) return null;
  const m = ADDR_RE.exec(t);
  if (m) return { addr: m[2].trim().toLowerCase(), name: m[1]?.trim() || null };
  const bare = /[^\s<>"]+@[^\s<>"]+/.exec(t);
  return bare ? { addr: bare[0].toLowerCase(), name: null } : null;
}

/** A comma-separated header (respecting quoted names) or an array -> Address[]. */
export function parseAddressList(v: unknown): Address[] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.flatMap((x) => (typeof x === "string" ? parseAddressList(x)
      : x && typeof x === "object" && "Email" in x ? [{ addr: String((x as { Email: string }).Email).toLowerCase(), name: (x as { Name?: string }).Name || null }]
      : x && typeof x === "object" && "address" in x ? [{ addr: String((x as { address: string }).address).toLowerCase(), name: (x as { name?: string }).name || null }]
      : []));
  }
  const parts: string[] = [];
  let cur = "", quoted = false;
  for (const ch of String(v)) {
    if (ch === '"') quoted = !quoted;
    if (ch === "," && !quoted) { parts.push(cur); cur = ""; } else cur += ch;
  }
  parts.push(cur);
  return parts.map(parseAddress).filter((a): a is Address => !!a);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n").trim();
}

const MAX_ATTACHMENT = 15 * 1024 * 1024;

function b64(s: unknown): Buffer {
  return Buffer.from(String(s ?? ""), "base64");
}

/** Postmark's inbound JSON. */
export function fromPostmark(j: Record<string, unknown>): ParsedEmail {
  const headers = Array.isArray(j.Headers) ? (j.Headers as { Name: string; Value: string }[]) : [];
  const header = (n: string) => headers.find((h) => h.Name.toLowerCase() === n.toLowerCase())?.Value;
  const authResults = headers.filter((h) => h.Name.toLowerCase() === "authentication-results").map((h) => h.Value);
  const fromFull = j.FromFull as { Email?: string; Name?: string } | undefined;
  const text = String(j.TextBody ?? "") || (j.HtmlBody ? htmlToText(String(j.HtmlBody)) : "");
  const from = fromFull?.Email ? { addr: fromFull.Email.toLowerCase(), name: fromFull.Name || null } : parseAddress(String(j.From ?? "")) ?? { addr: "unknown@unknown", name: null };
  return {
    messageId: String(header("Message-ID") ?? j.MessageID ?? "") || null,
    from,
    senderVerified: senderAuthenticated(authResults, header("Received-SPF"), from.addr),
    to: parseAddressList(j.ToFull ?? j.To),
    envelopeTo: parseAddressList(j.OriginalRecipient),
    cc: parseAddressList(j.CcFull ?? j.Cc),
    subject: String(j.Subject ?? ""),
    text,
    html: j.HtmlBody ? String(j.HtmlBody) : null,
    date: j.Date ? new Date(String(j.Date)) : new Date(),
    attachments: cap((Array.isArray(j.Attachments) ? j.Attachments : []).map((a: Record<string, unknown>) => ({
      filename: String(a.Name ?? "attachment"), mime: String(a.ContentType ?? "application/octet-stream"), data: b64(a.Content),
    }))),
  };
}

/** The generic JSON shape. */
export function fromGeneric(j: Record<string, unknown>): ParsedEmail {
  const html = j.html ? String(j.html) : null;
  const from = parseAddress(String(j.from ?? "")) ?? { addr: "unknown@unknown", name: null };
  return {
    messageId: j.messageId ? String(j.messageId) : j["message-id"] ? String(j["message-id"]) : null,
    from,
    // A relay holding the inbound token can pass on what the receiving server reported.
    senderVerified: j.senderVerified === true || senderAuthenticated(j.authenticationResults ? String(j.authenticationResults) : undefined, undefined, from.addr),
    to: parseAddressList(j.to),
    envelopeTo: parseAddressList(j.envelopeTo ?? j.recipient),
    cc: parseAddressList(j.cc),
    subject: String(j.subject ?? ""),
    text: String(j.text ?? "") || (html ? htmlToText(html) : ""),
    html,
    date: j.date ? new Date(String(j.date)) : new Date(),
    attachments: cap((Array.isArray(j.attachments) ? j.attachments : []).map((a: Record<string, unknown>) => ({
      filename: String(a.filename ?? a.name ?? "attachment"), mime: String(a.contentType ?? a.mime ?? "application/octet-stream"), data: b64(a.content),
    }))),
  };
}

/** Raw RFC 822 MIME, parsed with mailparser. */
export async function fromRaw(raw: Buffer | string): Promise<ParsedEmail> {
  const { simpleParser } = await import("mailparser");
  const m = await simpleParser(raw);
  const list = (v: unknown): Address[] => {
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    return arr.flatMap((x: { value?: { address?: string; name?: string }[] }) =>
      (x.value ?? []).filter((a) => a.address).map((a) => ({ addr: a.address!.toLowerCase(), name: a.name || null })));
  };
  const from = list(m.from)[0] ?? { addr: "unknown@unknown", name: null };
  const html = typeof m.html === "string" ? m.html : null;
  // Raw lines, top of the message first: every occurrence, however many a sender added.
  const every = (name: string) => (m.headerLines ?? []).filter((h) => h.key === name).map((h) => h.line.slice(h.line.indexOf(":") + 1).replace(/\r?\n\s+/g, " ").trim());
  return {
    messageId: m.messageId ?? null,
    from,
    senderVerified: senderAuthenticated(every("authentication-results"), every("received-spf")[0], from.addr),
    to: list(m.to),
    envelopeTo: ["x-original-to", "delivered-to", "x-forwarded-to", "envelope-to", "x-envelope-to"]
      .flatMap((h) => { const v = m.headers.get(h); return v ? parseAddressList(typeof v === "string" ? v : (v as { text?: string }).text ?? String(v)) : []; }),
    cc: list(m.cc),
    subject: m.subject ?? "",
    text: m.text ?? (html ? htmlToText(html) : ""),
    html,
    date: m.date ?? new Date(),
    attachments: cap((m.attachments ?? []).filter((a) => a.contentDisposition !== "inline" || a.contentType === "application/pdf")
      .map((a) => ({ filename: a.filename ?? "attachment", mime: a.contentType, data: a.content }))),
  };
}

/** Pick the parser for a JSON body. */
export async function fromJson(j: Record<string, unknown>): Promise<ParsedEmail> {
  if (typeof j.raw === "string") return fromRaw(j.raw);
  if ("FromFull" in j || "TextBody" in j || "MessageID" in j) return fromPostmark(j);
  return fromGeneric(j);
}

// ───────────────────────── Forwarded messages

export type Forwarded = { from: Address; subject: string | null; body: string; note: string } | null;

const FORWARD_MARKERS = [
  /-{5,}\s*Forwarded message\s*-{5,}/i,         // Gmail
  /Begin forwarded message:/i,                  // Apple Mail
  /-{3,}\s*Original Message\s*-{3,}/i,          // Outlook (older)
  /^_{10,}\s*$/m,                               // Outlook (newer) separator line
  /^-{2,}\s*Forwarded by/im,
];

/**
 * When an account manager forwards a client's email, the client's address is inside the body.
 * Returns the original sender, subject and the forwarded part, or null if this isn't a forward. Outlook
 * puts the same separator above the quoted message in an ordinary reply, so without a forward prefix on
 * the subject a marker only counts when the envelope sender is staff (CR-003).
 */
export function detectForward(subject: string, text: string, fromStaff = false): Forwarded {
  const isFwdSubject = /^\s*(fwd?|fw)\s*:/i.test(subject);
  if (!isFwdSubject && !fromStaff) return null;
  let start = -1;
  for (const re of FORWARD_MARKERS) {
    const m = re.exec(text);
    if (m && (start < 0 || m.index < start)) start = m.index;
  }
  const region = start >= 0 ? text.slice(start) : isFwdSubject ? text : "";
  if (!region) return null;
  const fromLine = /^\s*\*?From:\*?\s*(.+)$/im.exec(region);
  if (!fromLine) return null;
  const from = parseAddress(fromLine[1].replace(/\[mailto:[^\]]+\]/i, "").replace(/\s+on behalf of.*$/i, ""));
  if (!from) return null;
  const subj = /^\s*\*?Subject:\*?\s*(.+)$/im.exec(region)?.[1]?.trim() ?? null;
  // The forwarded body starts after the header block (first blank line after From:).
  const afterHeaders = region.slice(fromLine.index).split(/\n\s*\n/).slice(1).join("\n\n").trim();
  return { from, subject: subj, body: afterHeaders || region, note: start > 0 ? text.slice(0, start) : "" };
}

export const stripSubjectPrefixes = (s: string) => s.replace(/^\s*((re|fwd?|fw|aw)\s*:\s*)+/i, "").trim();

/** The new part of a message: drop quoted replies ("On ... wrote:", "> " lines) and common signatures. */
export function newContent(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message/i.test(line) || /^_{10,}\s*$/.test(line) || /^From: .+/.test(line) && out.length > 2) break;
    if (/^>/.test(line)) continue;
    if (/^(--\s*|Sent from my (iPhone|iPad|Android|phone))/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
