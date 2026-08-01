import { defineConfig } from "vitest/config";

// First-run e2e smoke test: drives the built desktop app against the Docker
// server fixture from packages/core. Needs a Docker daemon and a built app —
// both are wired into `pnpm test:e2e` (build first, then this config).
export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    globalSetup: ["e2e/global-setup.ts"],
    // The first deploy against a fresh fixture installs dependencies on the
    // server — minutes, not seconds. Bounded so the run can never hang.
    testTimeout: 600_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
