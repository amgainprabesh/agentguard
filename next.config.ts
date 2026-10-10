import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // hackathon scale; keeps one process on Render free tier
  serverExternalPackages: [],
};

export default nextConfig;
