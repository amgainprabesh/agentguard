import type { NextConfig } from "next";

// Security headers on every response. A localhost demo doesn't face the open
// internet, but these are free: judges often open apps in shared browsers, and
// the audit page renders untrusted ledger text (LLM/vendor strings), so the
// baseline matters.
//
// CSP TRAPS (both verified live, both blanked the whole app):
// 1. script-src without 'unsafe-inline' breaks Next in DEV *and* PROD: the
//    framework ships inline <script>self.__next_f.push(...)</script> RSC
//    payloads on every page. Blocked inline script = React never boots = an
//    empty page with readyState "complete" and ZERO console errors (the block
//    happens before any JS runs, so nothing can report it).
// 2. script-src without 'unsafe-eval' breaks DEV hydration: Next dev compiles
//    with the "eval-source-map" devtool, so eval() is how chunks load. Pages
//    with effects (/mandate, /audit) then sit on "Loading…" forever.
//
// Next's nonce middleware is the real fix (per-request nonce allows the
// framework's inline scripts, blocks attacker-injected ones). Until
// middleware is wired up, the honest baseline is the permissive directives —
// the other headers (nosniff, frame-ancestors, referrer) still do real work.
// NOTE: 'unsafe-inline' is required in dev AND prod (see trap 1) and
// 'unsafe-eval' in dev (trap 2), so one shared directive — branching on
// NODE_ENV here is useless: `next start` doesn't set it at config-load time.
const scriptSrc = "'self' 'unsafe-inline' 'unsafe-eval'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // hackathon scale; keeps one process on Render free tier
  serverExternalPackages: [],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
