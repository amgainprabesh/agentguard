import type { NextConfig } from "next";

// Security headers on every response. A localhost demo doesn't face the open
// internet, but these are free: judges often open apps in shared browsers, and
// the audit page renders untrusted ledger text (LLM/vendor strings), so the
// baseline matters.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Content-Security-Policy",
    // 'unsafe-inline' for style-src only: Tailwind injects inline <style>.
    // No script-src unsafe-*: this app has zero inline scripts.
    value: [
      "default-src 'self'",
      "script-src 'self'",
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
