import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["p4.localhost"],
  experimental: {
    serverActions: { bodySizeLimit: "64kb" },
  },
};

export default nextConfig;
