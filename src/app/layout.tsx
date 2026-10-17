import type { Metadata } from "next";
import "./globals.css";

// Per-request CSP nonce (src/middleware.ts) only reaches the framework's inline
// scripts on DYNAMIC renders — a prerendered page would ship build-time HTML
// whose inline scripts the request-time nonce blocks (blank page). Nothing here
// benefits from prerendering anyway: every view fetches its data client-side.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AgentGuard — spend policy for AI purchasing agents",
  description:
    "Policy is code, not prompt: every AI-agent purchase passes a deterministic spend policy before money moves, and every decision lands in a hash-chained audit ledger.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
