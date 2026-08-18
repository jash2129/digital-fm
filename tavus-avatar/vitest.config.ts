import { resolve } from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "server-only": resolve(__dirname, "test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
  },
});
