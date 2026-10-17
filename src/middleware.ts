import { NextRequest, NextResponse } from "next/server";

// Security middleware for every dynamic route (static assets excluded by the matcher).
//
// 1. CSRF / cross-site origin check on mutating methods: a browser request from
//    another origin carries `Sec-Fetch-Site: cross-site` — reject it. Non-browser
//    API clients (curl, scripts) send no Sec-Fetch-Site header and pass through;
//    the demo's own pages are same-origin. This closes the "any website can POST
//    to the API while an operator browses" hole without breaking the demo UI.
// 2. Optional shared-secret auth: set AGENTGUARD_TOKEN in the environment and
//    every mutating request must also send `x-agentguard-token: <same value>`.
//    Unset (the demo default) = origin check only.
// 3. CSP: static headers can't carry a per-request nonce, so 'unsafe-inline'
//    must stay for script-src — Next's inline RSC bootstrap scripts are rendered
//    WITHOUT the middleware nonce (verified on next@15.5.27: even a request-level
//    CSP nonce never appears on the emitted <script> tags, and a nonce-only
//    script-src blanks every page). PROD still drops 'unsafe-eval' (only dev's
//    eval-based chunk loading needs it) and gains object-src 'none'. The real
//    fix is nonce support in Next's bootstrap scripts — revisit on a next major.

const MUTATING = new Set(["POST", "PUT", "DELETE", "PATCH"]);

export function middleware(req: NextRequest) {
  if (MUTATING.has(req.method)) {
    const site = req.headers.get("sec-fetch-site");
    if (site === "cross-site") {
      return NextResponse.json({ error: "cross-site request rejected" }, { status: 403 });
    }
    const token = process.env.AGENTGUARD_TOKEN;
    if (token && req.headers.get("x-agentguard-token") !== token) {
      return NextResponse.json({ error: "missing or invalid x-agentguard-token" }, { status: 403 });
    }
  }

  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${devEval}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
