import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  distDir: process.env.CLEARFI_NEXT_DIR ?? ".next",
  experimental: { optimizePackageImports: ["@phosphor-icons/react"] },
  // Native SQLite driver must stay a server-side Node dependency.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
