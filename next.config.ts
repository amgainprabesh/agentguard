import type { NextConfig } from "next";

// Security headers on every response. The CSP lives in src/middleware.ts now —
// it needs a per-request nonce (generated there), which static headers() cannot
// provide. These static headers are the nonce-free remainder.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  // hackathon scale; keeps one process on Render free tier
  serverExternalPackages: [],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
