import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-cron"],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
