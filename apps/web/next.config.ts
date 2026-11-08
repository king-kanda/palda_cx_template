import type { NextConfig } from "next";
import { loadEnv } from "@garden/db";

// Next runs with `apps/web` as cwd; load the repo-root .env so the dev server,
// server actions and route handlers see the same configuration as the worker.
loadEnv();

const nextConfig: NextConfig = {
  transpilePackages: [
    "@garden/db",
    "@garden/engine",
    "@garden/integrations",
    "@garden/mcp-server",
    "@garden/services",
    "@garden/verticals",
  ],
  serverExternalPackages: ["postgres", "pg-boss", "@react-pdf/renderer"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
