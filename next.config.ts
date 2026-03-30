import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node-cron"],
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    instrumentationHook: true,
  },
};

export default nextConfig;
