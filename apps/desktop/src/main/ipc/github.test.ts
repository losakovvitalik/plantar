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

const { handlers, commitFiles, fetchSecretsPublicKey, putSecrets } = vi.hoisted(() => ({
  handlers: new Map<string, unknown>(),
  commitFiles: vi.fn(),
  fetchSecretsPublicKey: vi.fn(),
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
  getToken: () => "gh-token",
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
