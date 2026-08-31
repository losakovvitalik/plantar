import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Default run = unit tests colocated with the sources. The first-run e2e
// smoke test under e2e/ needs Docker and a built app and runs via
// `pnpm test:e2e` (e2e/vitest.config.ts).
export default defineConfig({
  resolve: {
    // The renderer alias from electron.vite.config.ts, so tests can import
    // component modules whose import chains use "@/..." paths
    alias: { "@": resolve(__dirname, "src/renderer/src") },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
