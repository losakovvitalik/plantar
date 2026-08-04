import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execFileMock }));

import { listRemoteBranches } from "./git";

const TOKEN = "ghp_TestToken1234567890";
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const URL = "https://github.com/acme/repo.git";

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

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

beforeEach(() => {
  execFileMock.mockReset();
});

describe("git auth token never leaks into thrown errors", () => {
  it("keeps the token out of argv and error messages when git fails with empty stderr", async () => {
    failLikeExecFile("");

    await expect(listRemoteBranches(URL, TOKEN)).rejects.toThrow();
    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    expect(thrown).not.toContain(TOKEN);
    expect(thrown).not.toContain(BASIC);

    // The source is gone: argv carries no token, so `ps` cannot see it either
    const [, args, opts] = execFileMock.mock.calls[0] as [
      string,
      string[],
      { env?: NodeJS.ProcessEnv },
    ];
    expect(args.join(" ")).not.toContain(BASIC);
    expect(args.join(" ")).not.toContain(TOKEN);
    // ...while the header still reaches git through the environment
    expect(opts.env?.GIT_CONFIG_COUNT).toBe("1");
    expect(opts.env?.GIT_CONFIG_KEY_0).toBe("http.extraHeader");
    expect(opts.env?.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${BASIC}`);
  });

  it("strips a Basic credential from the message even if git itself echoes it", async () => {
    failLikeExecFile(`fatal: unable to access: header Authorization: Basic ${BASIC} rejected`);

    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    expect(thrown).not.toContain(BASIC);
    expect(thrown).not.toContain(TOKEN);
    expect(thrown).toContain("fatal: unable to access");
  });

  it("still reports git stderr when it is present", async () => {
    failLikeExecFile("fatal: repository not found");

    const thrown = await listRemoteBranches(URL, TOKEN).catch((e: Error) => e.message);
    expect(thrown).toContain("fatal: repository not found");
  });
});
