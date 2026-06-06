/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages ship as TypeScript source; let Next transpile them.
  transpilePackages: ["@appbazaar/core", "@appbazaar/db"],
  // Keep native/wasm-bearing DB drivers out of the bundle; load them at runtime.
  // (Next 14 uses the experimental key; Next 15 renames it to serverExternalPackages.)
  experimental: {
    serverComponentsExternalPackages: ["@electric-sql/pglite", "postgres"],
  },
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    // Workspace packages use NodeNext-style ".js" specifiers that actually
    // point at TypeScript sources; let webpack resolve them to ".ts".
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
