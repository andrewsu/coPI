import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Produce a self-contained build in .next/standalone for Docker
  output: "standalone",
};

export default nextConfig;
