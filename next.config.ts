import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse"],
  async redirects() {
    return [
      {
        source: "/axon",
        destination: "https://axon.ai-emergence.xyz/",
        permanent: false,
      },
      {
        source: "/axon/:path*",
        destination: "https://axon.ai-emergence.xyz/:path*",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
