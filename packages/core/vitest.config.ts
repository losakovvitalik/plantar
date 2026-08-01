import { defineConfig } from "vitest/config";

// Default run = unit tests only. Integration tests under test/integration
// need a Docker daemon and run via `pnpm test:integration`
// (vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
