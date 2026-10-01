import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Preserve absolute redirects from 127.0.0.1 to the localhost OIDC origin.
  skipProxyUrlNormalize: true,
  serverExternalPackages: ["@janssenproject/cedarling_wasm"],
  experimental: {
    serverActions: { bodySizeLimit: "64kb" },
  },
};

export default nextConfig;
