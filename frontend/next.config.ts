import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  webpack: (config, { dev }) => {
    if (dev) {
      // Limit parallel compilation workers so memory stays bounded
      config.parallelism = 1;

      // Disable filesystem cache in dev (can grow large)
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
