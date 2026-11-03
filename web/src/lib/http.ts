// HTTP helpers. Pure module so node:test can load it.

/**
 * Content-Disposition safe for any filename. Header values must be Latin-1, so send an
 * ASCII fallback plus the real name RFC 5987-encoded (browsers prefer filename*).
 */
export function contentDisposition(filename: string, disposition: "inline" | "attachment"): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "") || "download";
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Where to send the user back to after a header form post: the Referer's path, but only
 * when the Referer is a well-formed URL on this host and the path is local ("/x", not "//x").
 */
/**
 * A path on this site to send someone to, or "/" (SEC-004). Browsers strip tabs and newlines while
 * parsing a URL, so "/\t/evil.example" arrives as "//evil.example": anything with a control
 * character, a space or a backslash is refused outright.
 */
export function safeLocalPath(next: string): string {
  if (!/^\/[^/]/.test(next) && next !== "/") return "/";
  if (/[\x00-\x20\x7f\\]/.test(next)) return "/";
  try {
    const url = new URL(next, "http://x");
    return url.origin === "http://x" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

const INLINE_TYPES = new Set(["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"]);

/** What the file's first bytes say it is, among the types we are willing to show in the browser. */
export function sniffType(data: Uint8Array): string | null {
  const at = (sig: number[], offset = 0) => sig.every((b, i) => data[offset + i] === b);
  if (at([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

const bareType = (mime: string) => mime.split(";")[0].trim().toLowerCase();

/**
 * The type to store for an uploaded or emailed file (SEC-001). The uploader chooses the declared
 * type, so a type a browser would run, or a PDF or image whose bytes disagree, is stored as plain bytes.
 */
export function storedMime(declared: string, data: Uint8Array): string {
  const t = bareType(declared);
  if (INLINE_TYPES.has(t)) return sniffType(data) === t ? t : "application/octet-stream";
  return /svg|html|xml|javascript|ecmascript/.test(t) || !t ? "application/octet-stream" : t;
}

/**
 * Response headers for a stored or generated file (SEC-001). Only a PDF or image whose bytes match is
 * shown in the browser; everything else downloads as plain bytes, whatever it was stored as. Chrome's
 * PDF viewer refuses to run under a CSP sandbox, so a verified PDF gets a policy without it.
 */
export function documentHeaders(filename: string, mime: string, data: Uint8Array): Record<string, string> {
  const t = bareType(mime);
  const inline = INLINE_TYPES.has(t) && sniffType(data) === t;
  return {
    "Content-Type": inline ? t : "application/octet-stream",
    "Content-Disposition": contentDisposition(filename, inline ? "inline" : "attachment"),
    "Content-Security-Policy": t === "application/pdf" && inline ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'self'; base-uri 'none'; form-action 'none'" : "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
}

export function safeReturnPath(referer: string | null, host: string | null, fallback = "/"): string {
  if (!referer) return fallback;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return fallback;
  }
  if (host && url.host !== host) return fallback;
  const path = url.pathname;
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return fallback;
  // Keep the page's own query (a case view, a search, a period) but not a flash message it already showed.
  const query = new URLSearchParams(url.search);
  query.delete("msg");
  query.delete("error");
  const q = query.toString();
  return q ? `${path}?${q}` : path;
}

type Env = Record<string, string | undefined>;

/**
 * The public origins this deployment is configured with: PUBLIC_BASE_URL holds one, or several
 * separated by commas or spaces when the app answers on more than one name (a custom domain and its
 * fly.dev name), canonical first. Empty when unset (local development). When set these are the only
 * names trusted for absolute links, the API's own URLs and the same-origin checks, so a forwarded
 * Host header can't steer them anywhere else (SEC-022).
 */
export function configuredOrigins(env: Env = process.env): string[] {
  const origins: string[] = [];
  for (const raw of (env.PUBLIC_BASE_URL ?? "").split(/[\s,]+/)) {
    if (!raw) continue;
    try {
      const u = new URL(raw);
      if ((u.protocol === "http:" || u.protocol === "https:") && !origins.includes(u.origin)) origins.push(u.origin);
    } catch {
      // not a URL: ignored
    }
  }
  return origins;
}

/** The canonical public origin (the first in PUBLIC_BASE_URL, e.g. "https://uwdesktop.siryous.app"), or null when unset. */
export function configuredOrigin(env: Env = process.env): string | null {
  return configuredOrigins(env)[0] ?? null;
}

/** The configured origin whose host is `host`, if it is one of this deployment's names. */
function ourOrigin(host: string, env: Env): string | undefined {
  return configuredOrigins(env).find((o) => new URL(o).host === host);
}

/** The host this request was addressed to: the proxy's forwarded host when present, else Host. */
export function requestHost(h: { get(name: string): string | null }): string {
  return (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
}

/**
 * Whether a state-changing request came from this site, for route handlers that take browser
 * form posts (Server Actions get this check from Next itself). Browsers send Sec-Fetch-Site on
 * every request and Origin on every POST, so a form a hostile page auto-submits is refused even
 * though the browser attached the session cookie or cached Basic credentials. A request with
 * neither header (curl, another system) passes: it carries no ambient browser credentials.
 * The expected host is any of the configured PUBLIC_BASE_URL names when set (SEC-024: a rebinding request
 * whose Origin and Host agree with each other but not with this deployment is refused), else the request's own.
 */
export function sameOrigin(h: { get(name: string): string | null }, env: Env = process.env): boolean {
  const site = h.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = h.get("origin") ?? h.get("referer");
  if (!origin) return true;
  if (origin === "null") return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return configuredOrigins(env).length ? ourOrigin(host, env) !== undefined : host === requestHost(h);
}

export const CROSS_SITE_REFUSED = "Cross-site request refused";

/**
 * The public origin to use for this request's absolute links in files and API documents. When
 * PUBLIC_BASE_URL is configured: the configured name the request came in on, so a page opened on
 * the custom domain links (and its MCP console posts) to the custom domain, or the canonical name
 * when the request came in under any other; otherwise (local development) the proxy's forwarded
 * host and scheme when present, else the Host header.
 */
export function requestOrigin(h: { get(name: string): string | null }, env: Env = process.env): string {
  const fixed = configuredOrigin(env);
  if (fixed) return ourOrigin(requestHost(h), env) ?? fixed;
  const host = requestHost(h) || "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0].trim() || (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Whether the request was addressed to one of this deployment's configured names (SEC-024). Always
 * true when PUBLIC_BASE_URL is unset. A request that reached us under another name is the tell of
 * DNS rebinding: a hostile page resolving its own name to this server's address.
 */
export function addressedToUs(h: { get(name: string): string | null }, env: Env = process.env): boolean {
  return !configuredOrigins(env).length || ourOrigin(requestHost(h), env) !== undefined;
}
