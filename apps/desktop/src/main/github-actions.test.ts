import { parseProjectConfig } from "@plantar/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWorkflowYaml, hasDeployWorkflow } from "./github-actions";

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

describe("hasDeployWorkflow", () => {
  const fetchMock = vi.fn();

  function stubAnswer(status: number, body = "{}"): void {
    fetchMock.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(body),
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("looks for the workflow file on the project's branch", async () => {
    // The setup commits the workflow to the branch the project deploys from,
    // which is not necessarily the default one: asked without the ref, GitHub
    // would answer about the default branch and miss the evidence there
    stubAnswer(200);

    await expect(
      hasDeployWorkflow("gh-token", "https://github.com/acme/shop", "release"),
    ).resolves.toBe(true);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/acme/shop/contents/.github/workflows/plantar-deploy.yml?ref=release",
    );
  });

  it("answers no when the repository does not hold the file", async () => {
    // No evidence that deploy on commit was ever set up for this project — the
    // caller leaves its record exactly as it is
    stubAnswer(404, '{"message":"Not Found"}');

    await expect(
      hasDeployWorkflow("gh-token", "https://github.com/acme/shop", "main"),
    ).resolves.toBe(false);
  });

  it("answers no when the repository has moved away from the recorded address", async () => {
    // A renamed or handed-over repository answers the old address with a
    // redirect. That says nothing about deploy on commit, and it must not turn
    // into an error either: the flow that asks is the reinstall confirmation
    stubAnswer(301, '{"message":"Moved Permanently"}');

    await expect(
      hasDeployWorkflow("gh-token", "https://github.com/acme/shop", "main"),
    ).resolves.toBe(false);
  });

  it("answers no when the request never arrives", async () => {
    // Offline, or GitHub unreachable: still no evidence, still no error out of
    // here — the check is bookkeeping the user did not ask for
    fetchMock.mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.github.com"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      hasDeployWorkflow("gh-token", "https://github.com/acme/shop", "main"),
    ).resolves.toBe(false);
  });

  it("answers no for a repository that is not on GitHub", async () => {
    // Deploy on commit only ever worked with github.com, so such a project
    // never had it — and nothing is asked of the network to find that out
    stubAnswer(200);

    await expect(
      hasDeployWorkflow("gh-token", "https://gitlab.com/acme/shop", "main"),
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
