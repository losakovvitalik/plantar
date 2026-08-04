import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

const TOKEN = "ghp_TestToken1234567890";
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const URL = "https://github.com/acme/repo.git";

type ExecCallback = (err: Error | null, stdout: unknown, stderr: string) => void;
type ExecCall = [string, string[], { env?: NodeJS.ProcessEnv }];

/**
 * git.ts memoizes the one-off `git --version` check at module level, so each
 * test re-imports a fresh module instead of sharing the cached result.
 */
async function importGit() {
  return await import("./git");
}

/** Rejects like Node's execFile: e.message quotes the full command line */
function failLikeExecFile(stderr: string): void {
  execFileMock.mockImplementation(
    (file: string, args: string[], _opts: unknown, cb: ExecCallback) => {
      const err = Object.assign(
        new Error(`Command failed: ${file} ${args.join(" ")}`),
        { code: 128, stderr, stdout: "" },
      );
      cb(err, "", stderr);
    },
  );
}

/**
 * Succeeds `git --version` with the given version and answers `ls-remote`
 * with one branch. The mocked execFile lacks Node's promisify.custom, so the
 * generic promisify resolves with the callback's second argument — passing
 * `{ stdout }` there mimics the real `{ stdout, stderr }` resolution shape.
 */
function mockGitVersion(version: string): void {
  execFileMock.mockImplementation(
    (_file: string, args: string[], _opts: unknown, cb: ExecCallback) => {
      if (args[0] === "--version") {
        cb(null, { stdout: `git version ${version}\n` }, "");
        return;
      }
      cb(null, { stdout: "ref: refs/heads/main\tHEAD\nabc123\trefs/heads/main\n" }, "");
    },
  );
}

function callsTo(subcommand: string): ExecCall[] {
  return (execFileMock.mock.calls as ExecCall[]).filter(
    ([, args]) => args[0] === subcommand,
  );
}

beforeEach(() => {
  execFileMock.mockReset();
  vi.resetModules();
});

describe("git auth token never leaks into thrown errors", () => {
  it("keeps the token out of argv and error messages when git fails with empty stderr", async () => {
    const { listRemoteBranches } = await importGit();
    failLikeExecFile("");

    await expect(listRemoteBranches(URL, TOKEN)).rejects.toThrow();
    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    expect(thrown).not.toContain(TOKEN);
    expect(thrown).not.toContain(BASIC);

    // The source is gone: argv carries no token, so `ps` cannot see it either
    for (const [, args] of execFileMock.mock.calls as ExecCall[]) {
      expect(args.join(" ")).not.toContain(BASIC);
      expect(args.join(" ")).not.toContain(TOKEN);
    }
    // ...while the header still reaches git through the environment
    const [, , opts] = callsTo("ls-remote")[0];
    expect(opts.env?.GIT_CONFIG_COUNT).toBe("1");
    expect(opts.env?.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(opts.env?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${BASIC}`);
  });

  it("strips a Basic credential from the message even if git itself echoes it", async () => {
    const { listRemoteBranches } = await importGit();
    failLikeExecFile(`fatal: unable to access: header Authorization: Basic ${BASIC} rejected`);

    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    expect(thrown).not.toContain(BASIC);
    expect(thrown).not.toContain(TOKEN);
    expect(thrown).toContain("fatal: unable to access");
  });

  it("still reports git stderr when it is present", async () => {
    const { listRemoteBranches } = await importGit();
    failLikeExecFile("fatal: repository not found");

    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    expect(thrown).toContain("fatal: repository not found");
  });
});

describe("git version check for GIT_CONFIG_* token auth", () => {
  it("rejects with a clear error when git is older than 2.31", async () => {
    const { listRemoteBranches } = await importGit();
    mockGitVersion("2.25.1");

    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    expect(thrown).toContain("2.25.1");
    expect(thrown).toContain("2.31");
    // The authenticated command is never spawned with silently ignored auth
    expect(callsTo("ls-remote")).toHaveLength(0);
  });

  it("proceeds when git is 2.31 or newer", async () => {
    const { listRemoteBranches } = await importGit();
    mockGitVersion("2.31.0");

    const result = await listRemoteBranches(URL, TOKEN);
    expect(result.branches).toEqual(["main"]);
    expect(result.default).toBe("main");
  });

  it("runs the version check once per process, only for authenticated calls", async () => {
    const { listRemoteBranches } = await importGit();
    mockGitVersion("2.39.3");

    await listRemoteBranches(URL); // no token — no check needed
    expect(callsTo("--version")).toHaveLength(0);

    await listRemoteBranches(URL, TOKEN);
    await listRemoteBranches(URL, TOKEN);
    expect(callsTo("--version")).toHaveLength(1);
  });

  it("does not block auth when `git --version` itself fails", async () => {
    const { listRemoteBranches } = await importGit();
    failLikeExecFile("fatal: repository not found");

    // The version check is skipped and the real call reports its own error
    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    expect(thrown).toContain("fatal: repository not found");
    expect(callsTo("ls-remote")).toHaveLength(1);
  });
});
