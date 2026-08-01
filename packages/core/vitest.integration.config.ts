import { defineConfig } from "vitest/config";

// Real-SSH integration tests against a disposable Docker server
// (test/integration/fixture). Run with `pnpm test:integration`.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    globalSetup: ["test/integration/global-setup.ts"],
    // Deploys over real SSH are slow; the failed-deploy scenario alone sits
    // through the 120 s HTTP readiness loop in waitForApp before recovering
    testTimeout: 300_000,
    hookTimeout: 120_000,
    // Scenarios share one server and build on each other's state
    fileParallelism: false,
  },
});
