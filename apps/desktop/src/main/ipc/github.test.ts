import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type ProjectRecord,
  type ServerRecord,
  readProjects,
  writeProjects,
  writeServers,
} from "@plantar/storage";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcResult, SetupActionsResult } from "../../shared/ipc";
import { registerGithubIpc } from "./github";

const server: ServerRecord = {
  id: "s1",
  name: "prod",
  host: "203.0.113.1",
  port: 22,
  user: "root",
  auth: "key",
  hostKeys: [{ type: "ssh-ed25519", fingerprint: "SHA256:recorded" }],
};

const { handlers, commitFiles, fetchSecretsPublicKey, getToken, hasDeployWorkflow, putSecrets } =
  vi.hoisted(() => ({
    handlers: new Map<string, unknown>(),
    commitFiles: vi.fn(),
    fetchSecretsPublicKey: vi.fn(),
    getToken: vi.fn(),
    hasDeployWorkflow: vi.fn(),
    putSecrets: vi.fn(),
  }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: unknown) => {
      handlers.set(channel, fn);
    },
  },
}));

// github-actions imports libsodium to seal the repository secrets, and its ESM
// entry does not resolve under vitest. Nothing here encrypts anything: the
// calls that would need it are replaced below
vi.mock("libsodium-wrappers", () => ({ default: { ready: Promise.resolve() } }));

// The GitHub session and the SSH work are stubbed out; the record store is the
// real one, so what the setup writes into the project record is what a later
// trust-host-key dialog would actually read
vi.mock("../github", () => ({
  getAccount: () => ({ login: "acme", canWriteWorkflows: true }),
  getToken,
  pollDeviceLogin: vi.fn(),
  signOut: vi.fn(),
  startDeviceLogin: vi.fn(),
}));

vi.mock("../connections", () => ({
  withServer: (
    _server: unknown,
    _password: unknown,
    fn: (conn: { hostKey: { type: string; fingerprint: string } }) => unknown,
  ) => fn({ hostKey: { type: "ssh-ed25519", fingerprint: "SHA256:live" } }),
}));

vi.mock("../ssh-setup", () => ({
  generateKeyPair: () =>
    Promise.resolve({ privateKeyPem: "PEM", publicKey: "ssh-ed25519 AAAA test" }),
  installPublicKey: () => Promise.resolve(),
  removeKeysWithComment: () => Promise.resolve(),
}));

// Only the calls that would reach the GitHub API are replaced; parsing the
// repo URL and building the workflow run for real
vi.mock("../github-actions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../github-actions")>()),
  commitFiles,
  fetchSecretsPublicKey,
  hasDeployWorkflow,
  putSecrets,
}));

registerGithubIpc();

interface SetupArgs {
  projectId: string;
  password?: string;
}

function invokeSetup(args: SetupArgs): Promise<IpcResult<SetupActionsResult>> {
  const handler = handlers.get("github:setupActions") as
    | ((event: unknown, args: SetupArgs) => Promise<IpcResult<SetupActionsResult>>)
    | undefined;
  if (!handler) throw new Error("github:setupActions handler was not registered");
  return handler({}, args);
}

function invokeBackfill(serverId: string): Promise<IpcResult<ProjectRecord[]>> {
  const handler = handlers.get("github:backfillDeployOnCommit") as
    | ((event: unknown, serverId: string) => Promise<IpcResult<ProjectRecord[]>>)
    | undefined;
  if (!handler) throw new Error("github:backfillDeployOnCommit handler was not registered");
  return handler({}, serverId);
}

let tmpHome: string;
let project: ProjectRecord;

// Point every OS-specific dataDir() variant into a fresh temp home
beforeEach(() => {
  tmpHome = mkdtempSync(path.join(os.tmpdir(), "plantar-github-ipc-test-"));
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  vi.stubEnv("XDG_DATA_HOME", path.join(tmpHome, "xdg"));
  vi.stubEnv("LOCALAPPDATA", path.join(tmpHome, "local"));

  // A real clone directory with a real plantar.json: the setup reads the file
  // itself to commit it next to the workflow
  const clone = path.join(tmpHome, "clone");
  mkdirSync(clone, { recursive: true });
  writeFileSync(
    path.join(clone, "plantar.json"),
    JSON.stringify({ name: "shop", type: "node", startCommand: "node index.js" }),
  );
  project = {
    id: "p1",
    serverId: server.id,
    name: "shop",
    path: clone,
    source: "git",
    repoUrl: "https://github.com/acme/shop",
    branch: "main",
  };
  writeServers([server]);
  writeProjects([project]);

  getToken.mockReturnValue("gh-token");
  fetchSecretsPublicKey.mockResolvedValue({ key_id: "1", key: "a".repeat(43) + "=" });
  putSecrets.mockResolvedValue(undefined);
  commitFiles.mockResolvedValue({ changed: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fetchSecretsPublicKey.mockReset();
  putSecrets.mockReset();
  commitFiles.mockReset();
  getToken.mockReset();
  hasDeployWorkflow.mockReset();
  rmSync(tmpHome, { recursive: true, force: true });
});

describe("github:setupActions", () => {
  it("records on the project that deploy on commit is set up", async () => {
    // The marker is the only local trace that the repository holds the
    // server's host key: the trust dialog names exactly the marked projects
    // when a reinstalled server's new key is about to replace the recorded one
    await expect(invokeSetup({ projectId: project.id })).resolves.toMatchObject({
      ok: true,
      data: { branch: "main" },
    });

    expect(readProjects()[0].deployOnCommit).toBe(true);
  });

  it("leaves the project unmarked when the setup fails before completing", async () => {
    // A setup that stopped short of committing the workflow left no deploy on
    // commit behind — marking it would make the trust dialog warn about a
    // failure that cannot happen
    commitFiles.mockRejectedValueOnce(new Error("no push rights"));

    await expect(invokeSetup({ projectId: project.id })).resolves.toMatchObject({
      ok: false,
    });

    expect(readProjects()[0].deployOnCommit).toBeUndefined();
  });
});

describe("github:backfillDeployOnCommit", () => {
  it("marks a setup made before the marker existed when its workflow is still there", async () => {
    // The record predates the marker, so nothing local says deploy on commit
    // exists — the workflow file the setup committed to the project's branch
    // does. With the marker written, the trust dialog names this project
    // instead of letting the user trust a new key with no warning at all
    hasDeployWorkflow.mockResolvedValue(true);

    const result = await invokeBackfill(server.id);

    expect(hasDeployWorkflow).toHaveBeenCalledWith("gh-token", project.repoUrl, project.branch);
    expect(result).toMatchObject({ ok: true });
    expect(readProjects()[0].deployOnCommit).toBe(true);
    // The answer carries the records as they now stand: the dialog reads its
    // warning from this list rather than asking for the projects again
    expect(result.ok && result.data[0].deployOnCommit).toBe(true);
  });

  it("marks only the project whose repository answered yes", async () => {
    // The repositories are asked all at once, so every answer has to find its
    // way back to the project it was asked about: the dialog names the marked
    // projects, and one named by mistake sends the user to set up a deploy on
    // commit it never had — over the workflow file of the one that has it
    const other: ProjectRecord = {
      ...project,
      id: "p2",
      name: "blog",
      repoUrl: "https://github.com/acme/blog",
    };
    writeProjects([project, other]);
    hasDeployWorkflow.mockImplementation((_token: string, repoUrl: string) =>
      Promise.resolve(repoUrl === other.repoUrl),
    );

    await expect(invokeBackfill(server.id)).resolves.toMatchObject({ ok: true });

    const projects = readProjects();
    expect(projects.find((p) => p.id === project.id)?.deployOnCommit).toBeUndefined();
    expect(projects.find((p) => p.id === other.id)?.deployOnCommit).toBe(true);
  });

  it("leaves the record untouched when the repository holds no evidence", async () => {
    // No workflow file, a repository that is gone or one that does not answer:
    // the same write-only-on-success bias the setup itself has
    hasDeployWorkflow.mockResolvedValue(false);

    await expect(invokeBackfill(server.id)).resolves.toMatchObject({ ok: true });

    expect(readProjects()[0].deployOnCommit).toBeUndefined();
  });

  it("leaves the records untouched when there is no GitHub login", async () => {
    // Nothing to ask GitHub with, so nothing is asked and nothing is written —
    // the dialog still opens and still warns about the markers already there
    getToken.mockReturnValue(null);

    await expect(invokeBackfill(server.id)).resolves.toMatchObject({ ok: true });

    expect(hasDeployWorkflow).not.toHaveBeenCalled();
    expect(readProjects()[0].deployOnCommit).toBeUndefined();
  });

  it("never clears the marker of an already marked project", async () => {
    // A marked project is not checked at all: the marker means the repository
    // was given the server's key, and a workflow file since deleted by hand
    // does not take that key back out of the repository secrets
    writeProjects([{ ...project, deployOnCommit: true }]);
    hasDeployWorkflow.mockResolvedValue(false);

    await expect(invokeBackfill(server.id)).resolves.toMatchObject({ ok: true });

    expect(hasDeployWorkflow).not.toHaveBeenCalled();
    expect(readProjects()[0].deployOnCommit).toBe(true);
  });
});
