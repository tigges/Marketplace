import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@appbazaar/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@appbazaar/db": resolve(__dirname, "packages/db/src/index.ts"),
      "@appbazaar/router-core": resolve(__dirname, "packages/router-core/src/index.ts"),
      "@appbazaar/router": resolve(__dirname, "apps/router/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
