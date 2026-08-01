import { defineConfig } from "vitest/config";

// Default run = unit tests colocated with the sources. The first-run e2e
// smoke test under e2e/ needs Docker and a built app and runs via
// `pnpm test:e2e` (e2e/vitest.config.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
