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

/** Same, for a subcommand that is not args[0] because `-C <dir>` comes first */
function callsIncluding(arg: string): ExecCall[] {
  return (execFileMock.mock.calls as ExecCall[]).filter(([, args]) =>
    args.includes(arg),
  );
}

/**
 * Succeeds `git --version` and answers `remote get-url origin` with the given
 * URL; every other command succeeds with empty output. Used for the calls that
 * run inside a clone, where the destination host comes from the origin remote.
 */
function mockCloneOrigin(originUrl: string): void {
  execFileMock.mockImplementation(
    (_file: string, args: string[], _opts: unknown, cb: ExecCallback) => {
      if (args[0] === "--version") {
        cb(null, { stdout: "git version 2.39.3\n" }, "");
        return;
      }
      if (args.includes("get-url")) {
        cb(null, { stdout: `${originUrl}\n` }, "");
        return;
      }
      cb(null, { stdout: "" }, "");
    },
  );
}

/** Environment of the first call running the given git subcommand */
function envOf(subcommand: string): NodeJS.ProcessEnv | undefined {
  const call = (execFileMock.mock.calls as ExecCall[]).find(([, args]) =>
    args.includes(subcommand),
  );
  return call?.[2].env;
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
    expect(opts.env?.GIT_CONFIG_COUNT).toBe("2");
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

describe("a repository GitHub has moved", () => {
  // What git prints when it is refused the redirect GitHub answers with for a
  // repository that was renamed or handed over to another owner
  const REDIRECTED = `fatal: unable to access '${URL}/': The requested URL returned error: 301`;

  it("explains the move and keeps git's own line after it", async () => {
    const { listRemoteBranches } = await importGit();
    // The dictionary answers in the language of the process, so the expected
    // text is taken from it rather than written out here
    const { t } = await import("./i18n");
    failLikeExecFile(REDIRECTED);

    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    // The explanation leads, and git's message stays below it: a 3xx that is
    // not a move at all (a proxy answering 302) would otherwise leave nothing
    // to go on
    expect(thrown).toContain(t("repoMoved", { message: REDIRECTED }));
  });

  it("leaves git's own message alone when the call carried no token", async () => {
    const { listRemoteBranches } = await importGit();
    failLikeExecFile(REDIRECTED);

    // Redirects are switched off only for an authenticated call, so a 3xx on
    // an unauthenticated one is not the failure this message describes
    const thrown = await listRemoteBranches(URL).catch((e: Error) => e.message);
    expect(thrown).toContain("The requested URL returned error: 301");
  });

  it("explains the move on a deploy, where the fetch is the authenticated call", async () => {
    const { updateRepo } = await importGit();
    const { t } = await import("./i18n");
    // The path a deploy takes: no URL among the arguments, so the host is read
    // off the clone's origin and the fetch is the call that carries the token
    execFileMock.mockImplementation(
      (_file: string, args: string[], _opts: unknown, cb: ExecCallback) => {
        if (args[0] === "--version") {
          cb(null, { stdout: "git version 2.39.3\n" }, "");
          return;
        }
        if (args.includes("get-url")) {
          cb(null, { stdout: `${URL}\n` }, "");
          return;
        }
        if (args.includes("fetch")) {
          const err = Object.assign(new Error("Command failed"), {
            code: 128,
            stderr: REDIRECTED,
          });
          cb(err, "", REDIRECTED);
          return;
        }
        cb(null, { stdout: "" }, "");
      },
    );

    const thrown = await updateRepo("/repos/app", "main", TOKEN).catch(
      (e: Error) => e.message,
    );
    // What a failed deploy actually shows: the explanation inside the update
    // error, instead of a bare status code
    expect(thrown).toBe(
      t("updateFailed", { message: t("repoMoved", { message: REDIRECTED }) }),
    );
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

describe("the GitHub token reaches github.com and nothing else", () => {
  // Repository URLs are pasted by the user or read off a server, so a host
  // that merely looks like GitHub must be treated as a foreign one
  const LOOKALIKES = [
    "https://github.com.evil.example/acme/repo.git",
    "https://www.github.com.evil.example/acme/repo.git",
    "https://notgithub.com/acme/repo.git",
    "https://github.com@evil.example/acme/repo.git",
    "https://evil.example/github.com/acme/repo.git",
    // A backslash ends the authority for `new URL()` but not for the parser
    // git uses: this reads as host github.com there, while git connects to
    // evil.example and would receive the header
    "https://github.com\\@evil.example/acme/repo.git",
  ];

  it("authenticates github.com and forbids redirects on the same call", async () => {
    const { listRemoteBranches } = await importGit();
    mockGitVersion("2.39.3");

    await listRemoteBranches(URL, TOKEN);

    const env = envOf("ls-remote");
    expect(env?.GIT_CONFIG_COUNT).toBe("2");
    expect(env?.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(env?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${BASIC}`);
    // Without this git could carry the header to wherever a 3xx points
    expect(env?.GIT_CONFIG_KEY_1).toBe("http.followRedirects");
    expect(env?.GIT_CONFIG_VALUE_1).toBe("false");
  });

  it("authenticates a www.github.com link and sends git to the apex host", async () => {
    const { listRemoteBranches } = await importGit();
    mockGitVersion("2.39.3");

    await listRemoteBranches("https://www.github.com/acme/repo.git", TOKEN);

    // www.github.com is GitHub, so the token belongs there — but it answers
    // every request with a redirect, and this call may not follow one
    expect(envOf("ls-remote")?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${BASIC}`);
    expect(callsTo("ls-remote")[0][1]).toContain(URL);
  });

  it("clones a www.github.com link from the apex host", async () => {
    const { cloneRepo } = await importGit();
    mockGitVersion("2.39.3");

    await cloneRepo("https://www.github.com/acme/repo.git", "main", "/repos/app", TOKEN);

    // The clone stores its target as origin, so this is also what keeps every
    // later fetch off the redirecting host
    expect(callsTo("clone")[0][1]).toContain(URL);
  });

  it("points an existing clone away from the redirecting www host", async () => {
    const { updateRepo } = await importGit();
    mockCloneOrigin("https://www.github.com/acme/repo.git");

    await updateRepo("/repos/app", "main", TOKEN);

    const repointed = callsIncluding("set-url");
    expect(repointed).toHaveLength(1);
    expect(repointed[0][1]).toContain(URL);
    expect(envOf("fetch")?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${BASIC}`);
  });

  it("withholds the token from another host but still runs the command", async () => {
    const { listRemoteBranches } = await importGit();
    mockGitVersion("2.39.3");

    // A public repository elsewhere keeps working — it just goes unauthenticated
    const result = await listRemoteBranches("https://gitlab.internal/team/app.git", TOKEN);
    expect(result.branches).toEqual(["main"]);

    expect(envOf("ls-remote")).toBeUndefined();
    for (const [, args, opts] of execFileMock.mock.calls as ExecCall[]) {
      const env = JSON.stringify(opts.env ?? {});
      expect(env).not.toContain(TOKEN);
      expect(env).not.toContain(BASIC);
      expect(env).not.toContain("http.extraHeader");
      expect(args.join(" ")).not.toContain(TOKEN);
    }
  });

  it.each(LOOKALIKES)("treats %s as a host of its own", async (url) => {
    const { listRemoteBranches } = await importGit();
    mockGitVersion("2.39.3");

    await listRemoteBranches(url, TOKEN);
    // envOf reads the env of a call that ran; a command that never ran reads
    // the same as one that ran without auth, so prove the spawn separately
    expect(callsTo("ls-remote")).toHaveLength(1);
    expect(envOf("ls-remote")).toBeUndefined();
  });

  it("withholds the token when the clone's origin is not on GitHub", async () => {
    const { updateRepo } = await importGit();
    mockCloneOrigin("https://gitlab.internal/team/app.git");

    await updateRepo("/repos/app", "main", TOKEN);

    // The host of a fetch is not in its arguments — it is read from the clone
    const lookups = callsIncluding("get-url");
    expect(lookups).toHaveLength(1);
    expect(lookups[0][2].env).toBeUndefined();
    expect(callsIncluding("fetch")).toHaveLength(1);
    expect(envOf("fetch")).toBeUndefined();
  });

  it("authenticates the fetch when the clone's origin is on GitHub", async () => {
    const { updateRepo } = await importGit();
    mockCloneOrigin(URL);

    await updateRepo("/repos/app", "main", TOKEN);

    expect(envOf("fetch")?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${BASIC}`);
    // Only the network call is authenticated; the local ones stay plain
    expect(envOf("checkout")).toBeUndefined();
    expect(envOf("reset")).toBeUndefined();
  });

  it("withholds the token when the clone has no readable origin", async () => {
    const { updateRepo } = await importGit();
    execFileMock.mockImplementation(
      (_file: string, args: string[], _opts: unknown, cb: ExecCallback) => {
        if (args.includes("get-url")) {
          const stderr = "error: No such remote 'origin'";
          cb(Object.assign(new Error("Command failed"), { code: 2, stderr }), "", stderr);
          return;
        }
        cb(null, { stdout: "" }, "");
      },
    );

    await updateRepo("/repos/app", "main", TOKEN);
    // A fetch that never ran reads the same as an unauthenticated one, so
    // prove the spawn separately (`fetch` is not args[0] — `-C <dir>` is)
    expect(callsIncluding("fetch")).toHaveLength(1);
    expect(envOf("fetch")).toBeUndefined();
  });

  it("withholds the token when the clone's origin only looks like GitHub", async () => {
    const { updateRepo } = await importGit();
    // Stored verbatim by git, so without this the token would go out to
    // evil.example again on every later deploy of the project
    mockCloneOrigin("https://github.com\\@evil.example/acme/repo.git");

    await updateRepo("/repos/app", "main", TOKEN);

    expect(callsIncluding("fetch")).toHaveLength(1);
    expect(envOf("fetch")).toBeUndefined();
  });

  it("withholds the token from a URL that carries credentials of its own", async () => {
    const { listRemoteBranches } = await importGit();
    mockGitVersion("2.39.3");

    // Userinfo is the half of the authority the two parsers split differently
    await listRemoteBranches("https://someone:secret@github.com/acme/repo.git", TOKEN);

    expect(callsTo("ls-remote")).toHaveLength(1);
    expect(envOf("ls-remote")).toBeUndefined();
  });
});
