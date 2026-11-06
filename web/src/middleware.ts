import { NextResponse, type NextRequest } from "next/server";
import { AUTH_USER_HEADER, authenticate, basicUsername, isPublicPath, loadUsers } from "@/lib/basic-auth";
import { requestOrigin } from "@/lib/http";
import { noteApiLogin, recordLogin } from "@/lib/login-events";
import { clientInfo } from "@/lib/login-meta";
import { SESSION_COOKIE, loginTag, readSession, sessionKey } from "@/lib/session";
import { loginState } from "@/lib/session-state";
import { isThrottled, noteFailure } from "@/lib/throttle";

// The sign-in gate (same model as the Underwriting Desktop): on when BASIC_AUTH_USERS is set (a Fly
// secret). Browsers sign in on /signin and carry a signed session cookie; other systems use the same
// logins with HTTP Basic. Without logins the gate is open only under `next dev`; a production server
// refuses to run open (SEC-015). This runs on every path, including the public ones (isPublicPath),
// so a client-supplied identity header is always removed (SEC-014). Document and mockup responses set
// their own, stricter policy.
export const config = {
  runtime: "nodejs",
  matcher: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
};

const CHALLENGE = { "WWW-Authenticate": 'Basic realm="siryous AMS", charset="UTF-8"' };
const NO_STORE = { "Cache-Control": "no-store" };
const ASSISTANT_MAX_BODY = 200_000;

/** SEC-016. Next reads the nonce from this header on the request and puts it on its own scripts. */
function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}'${dev ? " 'unsafe-eval'" : ""}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
    `connect-src 'self'${dev ? " ws:" : ""}`, "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
  ].join("; ");
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const headers = new Headers(req.headers);
  headers.delete(AUTH_USER_HEADER);   // only this middleware may say who is signed in
  const csp = /^\/(api|documents)(\/|$)|^\/admin\/app-tests\/mockups\//.test(path) ? null : contentSecurityPolicy(Buffer.from(crypto.randomUUID()).toString("base64"));
  if (csp) headers.set("content-security-policy", csp);
  const pass = () => {
    const res = NextResponse.next({ request: { headers } });
    if (csp) res.headers.set("Content-Security-Policy", csp);
    return res;
  };
  // The framework can fail on a large body before a route sees it, so the assistant's limit is checked here first.
  if (path === "/assistant/ask" && Number(req.headers.get("content-length") ?? 0) > ASSISTANT_MAX_BODY) {
    return NextResponse.json({ error: "That conversation is too long. Start a new one." }, { status: 413, headers: NO_STORE });
  }
  if (isPublicPath(path)) return pass();
  const users = loadUsers(process.env);
  if (!users.size) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Sign-in is not configured on this deployment (set the BASIC_AUTH_USERS secret).",
        { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", ...NO_STORE } });
    }
    return pass();
  }

  const cookie = req.cookies.get(SESSION_COOKIE)?.value;
  let name: string | null = null, disabled = false, ended = false;
  try {
    const key = sessionKey(process.env);
    const session = readSession(cookie, key);
    if (session) {
      const password = users.get(session.name);
      const state = password !== undefined && session.login === loginTag(session.name, password, key) ? await loginState(session.name, cookie) : null;
      if (state?.active === false) disabled = true;
      else if (!state || state.revoked || state.version !== session.version) ended = true;
      else name = session.name;
    }
    const auth = req.headers.get("authorization");
    if (!name && !disabled && auth) {
      const throttle = `basic:${clientInfo(req.headers).ip ?? "local"}`;
      if (isThrottled(throttle)) return new NextResponse("Too many failed sign-ins. Wait a minute and try again.", { status: 429, headers: { "Retry-After": "60", ...NO_STORE } });
      name = authenticate(auth, users);
      if (name) {
        if ((await loginState(name)).active === false) { disabled = true; name = null; }
        else noteApiLogin(name, req.headers);
      } else {
        noteFailure(throttle);
        const tried = basicUsername(auth);
        await recordLogin(tried && users.has(tried) ? tried : "(unknown user)", false, "api", req.headers).catch((err) => console.error("login-events: API sign-in not recorded", err));
      }
    }
  } catch (err) {
    console.error("middleware: could not check the login", err);
    return new NextResponse("Sign-in is unavailable. Try again in a moment.", { status: 503, headers: NO_STORE });
  }
  if (name) {
    headers.set(AUTH_USER_HEADER, name);
    return pass();
  }

  const respond = () => {
    if (path.startsWith("/api/")) {
      return disabled
        ? NextResponse.json({ error: { code: "forbidden", message: "This login has been turned off." } }, { status: 403, headers: NO_STORE })
        : NextResponse.json({ error: { code: "unauthorized", message: "Authentication required: HTTP Basic with a siryous AMS login." } }, { status: 401, headers: { ...CHALLENGE, ...NO_STORE } });
    }
    if (req.method === "GET" && (req.headers.get("accept") ?? "").includes("text/html")) {
      // The address the browser used: in the standalone image `req.url` is the server's own.
      const next = `${path}${req.nextUrl.search}`;
      const query = disabled ? "?disabled=1" : next !== "/" ? `?${new URLSearchParams({ next })}` : "";
      return NextResponse.redirect(new URL(`/signin${query}`, requestOrigin(req.headers)));
    }
    return NextResponse.json({ error: { code: "unauthorized", message: "Your sign-in has ended. Reload the page to sign in again." } }, { status: 401, headers: NO_STORE });
  };
  const res = respond();
  if (disabled || ended) res.cookies.delete(SESSION_COOKIE);
  return res;
}
