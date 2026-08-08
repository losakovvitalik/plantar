import { parseProjectConfig } from "@plantar/config";
import { describe, expect, it, vi } from "vitest";
import { buildWorkflowYaml } from "./github-actions";

// The module under test imports libsodium to seal the repository secrets, and
// its ESM entry does not resolve under vitest. Nothing here encrypts anything.
vi.mock("libsodium-wrappers", () => ({ default: { ready: Promise.resolve() } }));

const config = parseProjectConfig({ name: "shop" });

describe("buildWorkflowYaml", () => {
  it("gives the deploy step the expected host key", () => {
    // The CI deploy has nobody to ask and no server records of its own: without
    // the pinned key it would upload the project to whatever answers at the
    // address. The CLI reads PLANTAR_HOST_KEY from the environment.
    const yaml = buildWorkflowYaml("main", config);

    expect(yaml).toContain("          PLANTAR_HOST_KEY: ${{ secrets.PLANTAR_HOST_KEY }}\n");
  });
});
