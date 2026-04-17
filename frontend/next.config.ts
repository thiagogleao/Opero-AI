import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  serverExternalPackages: ['pg', 'pg-pool', 'pg-connection-string', 'pgpass'],
  webpack: (config, { dev, isServer }) => {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        pg: false,
        pgpass: false,
        'pg-pool': false,
        'pg-connection-string': false,
        'pg-native': false,
        split2: false,
      }
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, path: false, stream: false, crypto: false,
        os: false, net: false, tls: false, dns: false,
        string_decoder: false,
      }
    }
    if (dev) {
      config.parallelism = 1;
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
