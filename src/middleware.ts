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
// 3. Per-request CSP nonce: Next reads the nonce from the CSP response header and
//    applies it to its own inline scripts, so script-src no longer needs
//    'unsafe-inline'. Dev still needs 'unsafe-eval' (eval-based chunk loading);
//    NODE_ENV is request-time inside middleware, so the branch is reliable here
//    (it is NOT at next.config load time — see the old config's comment).

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

  const nonce = btoa(crypto.randomUUID());
  const devEval = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${devEval}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
