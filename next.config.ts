import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite driver must stay a server-side Node dependency.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
