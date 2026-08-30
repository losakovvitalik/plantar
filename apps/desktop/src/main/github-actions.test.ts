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

    // The indentation is the template's own business — only the env line matters
    expect(yaml).toMatch(/^\s*PLANTAR_HOST_KEY: \$\{\{ secrets\.PLANTAR_HOST_KEY \}\}$/m);
  });

  it("gives it the type of that key as well", () => {
    // The fingerprint alone leaves the type to the ssh library, so a server
    // that has since gained a key of a type it prefers more would answer the CI
    // run with that one and fail the check. With the type the run asks for the
    // pinned key's type first, the way the app does with a recorded server.
    const yaml = buildWorkflowYaml("main", config);

    expect(yaml).toMatch(
      /^\s*PLANTAR_HOST_KEY_TYPE: \$\{\{ secrets\.PLANTAR_HOST_KEY_TYPE \}\}$/m,
    );
  });
});
