import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
const githubPagesBasePath = "/EstiloSol-page";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  ...(isProd
    ? { basePath: githubPagesBasePath, assetPrefix: githubPagesBasePath }
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
      {
        protocol: "https",
        hostname: "i.ibb.co",
      },
    ],
    unoptimized: true,
  },
};

export default nextConfig;
