import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const isGitHubPages = basePath.length > 0;

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        basePath,
        assetPrefix: basePath,
        trailingSlash: true,
        output: "export",
      }
    : {}),
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "via.placeholder.com",
      },
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
    ...(isGitHubPages ? { unoptimized: true } : {}),
  },
};

export default nextConfig;
