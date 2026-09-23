import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // No React plugin needed: esbuild's automatic JSX runtime handles TSX
  // and this avoids a version clash with the app's pinned Vite.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
